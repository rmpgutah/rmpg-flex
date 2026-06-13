import type { Bindings } from '../../types';
import type { ScreeningAdapter, NormalizedCandidate, PersonRow, SearchParams, MatchResult, ScreeningHitRow } from './types';
import { scoreSanctionMatch } from './scoring';
import { getDb, query, queryFirst, execute, executeBatch } from '../db';

const BULK_URL = 'https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json';

interface CslResult {
  id?: string;
  source?: string;
  type?: string;
  name?: string;
  alt_names?: string[];
  programs?: string[];
  addresses?: { country?: string }[];
  dates_of_birth?: string[];
  nationalities?: string[];
  remarks?: string;
}

// Fix 1: safe JSON.parse helper — never throws; returns fallback on any parse error.
export function safeParse<T>(s: unknown, fallback: T): T {
  try { return JSON.parse(String(s ?? '')) as T; } catch { return fallback; }
}

export function normalizeOfacRow(raw: unknown): NormalizedCandidate {
  const r = (raw ?? {}) as CslResult;
  const programs = Array.isArray(r.programs) ? r.programs : [];
  const nats = Array.isArray(r.nationalities) ? r.nationalities : [];
  const country = r.addresses?.[0]?.country ?? nats[0];
  const listType = (r.source ?? '').includes('SDN') ? 'SDN' : (r.source ?? 'CSL');
  return {
    sourceKey: 'ofac-csl',
    externalId: r.id ?? '',
    displayName: r.name ?? 'unknown',
    summary: `OFAC ${listType}${programs.length ? ` · ${programs.join(', ')}` : ''}`,
    country,
    listType,
    dob: r.dates_of_birth?.[0] ?? null,
    nationalities: nats,
    raw,
  };
}

// Fix 1: Row stored in ofac_sanctions → candidate (exported + robust via safeParse).
export function rowToCandidate(row: Record<string, unknown>): NormalizedCandidate {
  const programs = safeParse<string[]>(row.programs, []);
  const nats = safeParse<string[]>(row.nationalities, []);
  const addresses = safeParse<{ country?: string }[]>(row.addresses, []);
  return {
    sourceKey: 'ofac-csl',
    externalId: String(row.uid ?? ''),
    displayName: String(row.name ?? 'unknown'),
    summary: `OFAC ${row.source_list ?? 'CSL'}${programs.length ? ` · ${programs.join(', ')}` : ''}`,
    country: addresses[0]?.country ?? nats[0],
    listType: String(row.source_list ?? 'CSL'),
    dob: (row.dob as string) ?? null,
    nationalities: nats,
    raw: safeParse<unknown>(row.raw_json, row),
  };
}

// Fix 3: Pure helper — returns the new caution_flags string, or null if already present (no change).
export function appendCautionFlag(existing: string | null, flag: string): string | null {
  const cur = existing ?? '';
  if (cur.includes(flag)) return null;
  return [cur, flag].filter(Boolean).join('; ');
}

// Fix 4: Escape LIKE wildcards in user-supplied input.
function likeContains(input: string | undefined | null): string {
  return `%${(input ?? '').trim().replace(/[%_\\]/g, '\\$&')}%`;
}

export async function ingestOfac(env: Bindings): Promise<{ rowsLoaded: number }> {
  const db = getDb(env);
  const startRun = await execute(db, 'INSERT INTO ofac_ingest_runs (source_url) VALUES (?)', BULK_URL);
  const runId = startRun.meta.last_row_id;
  try {
    const res = await fetch(BULK_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`bulk fetch ${res.status}`);
    const body = (await res.json()) as { results?: CslResult[] };
    const results = body.results ?? [];

    // Fix 2: Capture a single run timestamp so every upserted row gets the same ingested_at.
    // This lets us DELETE anything older (delisted entities) after the batch succeeds.
    const tsRow = await queryFirst<{ now: string }>(db, "SELECT datetime('now') AS now");
    const runTs = tsRow?.now ?? '';

    const CHUNK = 100;
    for (let i = 0; i < results.length; i += CHUNK) {
      const slice = results.slice(i, i + CHUNK);
      await executeBatch(db, slice.map((r) => ({
        sql: `INSERT OR REPLACE INTO ofac_sanctions
                (uid, source_list, entity_type, name, alt_names, programs, addresses, dob, nationalities, remarks, raw_json, ingested_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?, ?)`,
        bindings: [
          r.id ?? '',
          (r.source ?? '').includes('SDN') ? 'SDN' : (r.source ?? 'CSL'),
          r.type ?? '',
          r.name ?? '',
          JSON.stringify(r.alt_names ?? []),
          JSON.stringify(r.programs ?? []),
          JSON.stringify(r.addresses ?? []),
          r.dates_of_birth?.[0] ?? null,
          JSON.stringify(r.nationalities ?? []),
          r.remarks ?? '',
          JSON.stringify(r),
          runTs,
        ],
      })));
    }

    // Fix 2: Purge entities no longer on the list (delisted) so cleared persons stop matching.
    await execute(db, 'DELETE FROM ofac_sanctions WHERE ingested_at < ? OR ingested_at IS NULL', runTs);

    await execute(db,
      "UPDATE ofac_ingest_runs SET finished_at = datetime('now'), rows_loaded = ? WHERE id = ?",
      results.length, runId);
    await execute(db,
      "UPDATE screening_source_state SET items_count = ?, last_success_at = datetime('now') WHERE source_key = 'ofac-csl'",
      results.length);
    return { rowsLoaded: results.length };
  } catch (err) {
    await execute(db,
      "UPDATE ofac_ingest_runs SET finished_at = datetime('now'), error = ? WHERE id = ?",
      String(err), runId);
    throw err;
  }
}

export async function ofacDataAgeHours(env: Bindings): Promise<number | null> {
  const row = await queryFirst<{ h: number }>(getDb(env),
    "SELECT (julianday('now') - julianday(MAX(ingested_at))) * 24 AS h FROM ofac_sanctions");
  return row?.h ?? null;
}

export const ofacAdapter: ScreeningAdapter = {
  sourceKey: 'ofac-csl',
  kind: 'sanction',
  label: 'OFAC / Consolidated Screening List',
  supportsSearch: true,
  supportsWatch: true,
  normalize: normalizeOfacRow,

  async searchAdHoc(env: Bindings, params: SearchParams): Promise<NormalizedCandidate[]> {
    const db = getDb(env);
    // Fix 4: escape LIKE wildcards in user input.
    const term = likeContains(params.name);
    const rows = await query<Record<string, unknown>>(db,
      "SELECT * FROM ofac_sanctions WHERE name LIKE ? ESCAPE '\\' LIMIT 50", term).catch(() => []);
    const local = rows.map(rowToCandidate);
    const key = await queryFirst<{ config_value: string }>(db,
      "SELECT config_value FROM system_config WHERE config_key = 'screening_ofac_csl_api_key' AND is_active = 1").catch(() => null);
    if (key?.config_value && params.name) {
      // Fix 5: When a CSL key is configured, the authoritative live fuzzy results REPLACE
      // the local cache results for this query (live is fresher than the daily bulk).
      const u = `https://data.trade.gov/consolidated_screening_list/v1/search?name=${encodeURIComponent(params.name)}&fuzzy_name=true`;
      const res = await fetch(u, {
        headers: { 'subscription-key': key.config_value, Accept: 'application/json' },
      }).catch(() => null);
      if (res?.ok) {
        const body = (await res.json()) as { results?: unknown[] };
        return (body.results ?? []).map(normalizeOfacRow);
      }
    }
    return local;
  },

  async fetchForPerson(env: Bindings, person: PersonRow): Promise<NormalizedCandidate[]> {
    if (!person.last_name) return [];
    const db = getDb(env);
    // Fix 4: escape LIKE wildcards in last_name.
    const rows = await query<Record<string, unknown>>(db,
      "SELECT * FROM ofac_sanctions WHERE name LIKE ? ESCAPE '\\' LIMIT 50",
      likeContains(person.last_name)).catch(() => []);
    return rows.map(rowToCandidate);
  },

  scoreMatch(person: PersonRow, candidate: NormalizedCandidate): MatchResult {
    return scoreSanctionMatch(person.last_name ?? '', person.first_name ?? '', candidate.displayName);
  },

  // Fix 3: Use appendCautionFlag to avoid duplicating the exact same sanction entry.
  async confirmHit(env: Bindings, hit: ScreeningHitRow): Promise<{ promotedRef: string }> {
    const db = getDb(env);
    if (hit.person_id) {
      const p = await queryFirst<{ caution_flags: string | null }>(db,
        'SELECT caution_flags FROM persons WHERE id = ?', hit.person_id).catch(() => null);
      const flag = `OFAC SANCTIONS: ${hit.list_type ?? 'CSL'} (${hit.external_id})`;
      const next = appendCautionFlag(p?.caution_flags ?? '', flag);
      if (next !== null) {
        await execute(db,
          'UPDATE persons SET caution_flags = ? WHERE id = ?',
          next, hit.person_id).catch(() => {});
      }
    }
    return { promotedRef: 'caution_flag' };
  },
};
