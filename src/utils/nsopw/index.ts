// ============================================================
// RMPG Flex — NSOPW orchestrator (the "do everything" function).
// ------------------------------------------------------------
// Public entry points:
//   runNsopwScreening(env, query)
//       Cache-aware federated lookup. The function used by the
//       screening adapter, the auto-trigger hooks, and the
//       manual API path.
//
//   screenPersonForSor(env, personId, opts?)
//       Convenience wrapper. Pulls a persons row, derives a
//       NsopwQuery, and runs screening for that one person.
//       Designed for waitUntil() from records/dispatch routes.
//
//   ensureNsopwColumns(env)
//       Runtime reconciler for the 0146 schema — deploy migration
//       step is continue-on-error, so the Worker self-heals.
//
// All persistence here flows through cache.ts + persist.ts; the
// HTTP call lives in client.ts; matching in match.ts. This file
// is the conductor.
// ============================================================

import type { Bindings } from '../../types';
import { getDb, queryFirst, execute, columnExists } from '../db';
import {
  type NsopwQuery, type ClassifiedCandidate,
  NsopwConfigError,
} from './types';
import { isConfigured, nsopwSearch } from './client';
import { classifyAll } from './match';
import { readCache, writeCache } from './cache';
import { upsertOffender } from './persist';

export * from './types';

/** Result of one screening run — what the caller actually wants. */
export interface NsopwScreeningResult {
  query: NsopwQuery;
  configured: boolean;
  cacheHit: boolean;
  confirmed: ClassifiedCandidate[];     // auto-confirm tier
  possible: ClassifiedCandidate[];      // officer-review tier
  excluded: number;                     // count only — never surfaced
  jurisdictionCoverage: Record<string, string>;
  runId: number | null;
  error?: string;
}

export interface RunOpts {
  triggeredBy?: string;                 // 'manual' | 'cron' | 'person_create' | ...
  skipCache?: boolean;
}

/**
 * Cache-aware federated NSOPW lookup. The one function that everyone calls.
 */
export async function runNsopwScreening(
  env: Bindings,
  query: NsopwQuery,
  opts: RunOpts = {},
): Promise<NsopwScreeningResult> {
  await ensureNsopwColumns(env).catch(() => {});
  const db = getDb(env);
  const triggeredBy = opts.triggeredBy ?? 'manual';

  // Empty queries are no-ops — never burn quota on a blank query.
  if (!query.surname?.trim() || !query.forename?.trim()) {
    return {
      query, configured: isConfigured(env), cacheHit: false,
      confirmed: [], possible: [], excluded: 0,
      jurisdictionCoverage: {}, runId: null,
      error: 'empty query (surname + forename required)',
    };
  }

  // Cache check — skipped when caller wants a fresh sweep.
  if (!opts.skipCache) {
    const cached = await readCache(db, query).catch(() => null);
    if (cached) {
      const classified = classifyAll(query, cached.rawResponse.offenders);
      const result = splitClassified(classified);
      await logRun(db, query, {
        kind: 'query',
        triggeredBy,
        cacheHit: 1,
        candidates: cached.rawResponse.offenders.length,
        confirmed: result.confirmed.length,
        possible: result.possible.length,
        excluded: result.excluded,
      });
      return {
        query, configured: isConfigured(env), cacheHit: true,
        confirmed: result.confirmed,
        possible: result.possible,
        excluded: result.excluded,
        jurisdictionCoverage: cached.rawResponse.jurisdictionCoverage as Record<string, string>,
        runId: null,
      };
    }
  }

  // Live query path. If unconfigured (no MOU yet) we return a
  // configured=false sentinel — the framework treats this as a
  // coverage gap, NEVER as a clearance.
  if (!isConfigured(env)) {
    await logRun(db, query, {
      kind: 'query', triggeredBy, cacheHit: 0,
      candidates: 0, confirmed: 0, possible: 0, excluded: 0,
      error: 'not_configured',
    });
    return {
      query, configured: false, cacheHit: false,
      confirmed: [], possible: [], excluded: 0,
      jurisdictionCoverage: {}, runId: null,
      error: 'NSOPW_API_KEY unset',
    };
  }

  let httpStatus = 0;
  let latencyMs = 0;
  let candidates = 0;
  let resultError: string | undefined;
  let classified: ClassifiedCandidate[] = [];
  let coverage: Record<string, string> = {};

  try {
    const r = await nsopwSearch(env, query);
    httpStatus = r.httpStatus;
    latencyMs = r.latencyMs;
    candidates = r.response.offenders.length;
    classified = classifyAll(query, r.response.offenders);
    coverage = r.response.jurisdictionCoverage as Record<string, string>;

    // Persist confirmed + possible (NOT excluded) so the review queue
    // works after cache expiry.
    const persistedIds: number[] = [];
    for (const c of classified) {
      if (c.classification === 'excluded') continue;
      try {
        const id = await upsertOffender(db, c.offender);
        if (id) persistedIds.push(id);
      } catch (err) {
        console.warn('[nsopw] persist failed:', err);
      }
    }
    // Cache (including misses — empty candidates).
    await writeCache(db, query, r.response, persistedIds).catch((err) => {
      console.warn('[nsopw] cache write failed:', err);
    });
  } catch (err) {
    if (err instanceof NsopwConfigError) {
      resultError = err.message;
    } else if (err instanceof Error) {
      resultError = err.message;
    } else {
      resultError = String(err);
    }
    console.error('[nsopw] search failed:', err);
  }

  const split = splitClassified(classified);
  const runId = await logRun(db, query, {
    kind: 'query',
    triggeredBy,
    cacheHit: 0,
    candidates,
    confirmed: split.confirmed.length,
    possible: split.possible.length,
    excluded: split.excluded,
    httpStatus,
    latencyMs,
    error: resultError,
  });

  return {
    query, configured: isConfigured(env), cacheHit: false,
    confirmed: split.confirmed,
    possible: split.possible,
    excluded: split.excluded,
    jurisdictionCoverage: coverage,
    runId,
    error: resultError,
  };
}

/**
 * Screen one local person (by id) against NSOPW. Used by the
 * auto-trigger hooks (waitUntil from records/dispatch routes) and
 * by the cron sweep when iterating a watchlist.
 *
 * Always writes confirmed hits into screening_hits so they flow
 * to the review queue and dossier through the existing framework.
 */
export async function screenPersonForSor(
  env: Bindings,
  personId: number,
  opts: RunOpts = {},
): Promise<NsopwScreeningResult | null> {
  const db = getDb(env);
  const p = await queryFirst<{
    id: number; first_name: string | null; middle_name: string | null;
    last_name: string | null; dob: string | null;
  }>(
    db,
    'SELECT id, first_name, middle_name, last_name, dob FROM persons WHERE id = ?',
    personId,
  ).catch(() => null);
  if (!p || !p.last_name || !p.first_name) return null;

  const result = await runNsopwScreening(env, {
    surname: p.last_name,
    forename: p.first_name,
    middleName: p.middle_name ?? undefined,
    dob: p.dob ?? undefined,
  }, opts);

  // Promote confirmed hits into screening_hits (engine's universal
  // review/dossier table). This wires NSOPW into the same review
  // queue + dossier path as every other adapter.
  for (const c of [...result.confirmed, ...result.possible]) {
    const status = c.classification === 'confirmed' ? 'pending' : 'pending';
    // External id collapses jurisdiction + offender_id so we never
    // collide across states.
    const externalId = `${c.offender.jurisdiction}:${c.offender.nsopwOffenderId}`;
    if (!externalId) continue;
    try {
      const existing = await queryFirst<{ id: number }>(
        db,
        'SELECT id FROM screening_hits WHERE source_key = ? AND person_id = ? AND external_id = ?',
        'nsopw', personId, externalId,
      );
      if (existing) {
        await execute(
          db,
          `UPDATE screening_hits SET last_seen_at = datetime('now'),
             match_score = ?, matched_fields = ?, is_active = 1
           WHERE id = ?`,
          c.score, JSON.stringify(c.matchedFields), existing.id,
        );
      } else {
        await execute(
          db,
          `INSERT INTO screening_hits (
             source_key, person_id, external_id, match_score, matched_fields,
             status, display_name, summary, photo_url, country, list_type, raw_json
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          'nsopw', personId, externalId,
          c.score, JSON.stringify(c.matchedFields), status,
          `${c.offender.firstName} ${c.offender.lastName}`.trim(),
          summaryFor(c),
          c.offender.photoUrl ?? null,
          'US',
          'nsopw',
          JSON.stringify(c),
        );
      }
    } catch (err) {
      console.warn('[nsopw] screening_hits insert failed:', err);
    }
  }

  return result;
}

function summaryFor(c: ClassifiedCandidate): string {
  const parts: string[] = [];
  parts.push(c.offender.jurisdictionLabel || c.offender.jurisdiction || 'NSOPW');
  if (c.offender.offense) parts.push(c.offender.offense);
  if (c.offender.riskLevel) parts.push(`Tier: ${c.offender.riskLevel}`);
  if (c.offender.city || c.offender.state) {
    parts.push([c.offender.city, c.offender.state].filter(Boolean).join(', '));
  }
  if (c.classification === 'possible') parts.push('(possible — needs review)');
  return parts.join(' · ');
}

function splitClassified(c: ClassifiedCandidate[]) {
  const confirmed = c.filter((x) => x.classification === 'confirmed');
  const possible = c.filter((x) => x.classification === 'possible');
  const excluded = c.filter((x) => x.classification === 'excluded').length;
  return { confirmed, possible, excluded };
}

async function logRun(
  db: ReturnType<typeof getDb>,
  q: NsopwQuery,
  fields: {
    kind: string; triggeredBy: string; cacheHit: 0 | 1;
    candidates: number; confirmed: number; possible: number; excluded: number;
    httpStatus?: number; latencyMs?: number; error?: string;
  },
): Promise<number | null> {
  try {
    const res = await execute(
      db,
      `INSERT INTO nsopw_runs (
         kind, triggered_by, query_surname, query_forename, query_dob,
         cache_hit, candidates_returned, confirmed_matches, possible_matches,
         excluded_matches, http_status, latency_ms, error
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      fields.kind, fields.triggeredBy,
      q.surname ?? '', q.forename ?? '', q.dob ?? '',
      fields.cacheHit, fields.candidates,
      fields.confirmed, fields.possible, fields.excluded,
      fields.httpStatus ?? null, fields.latencyMs ?? null, fields.error ?? null,
    );
    const meta = (res as { meta?: { last_row_id?: number } }).meta;
    return meta?.last_row_id ?? null;
  } catch (err) {
    console.warn('[nsopw] run-log insert failed:', err);
    return null;
  }
}

// ── Runtime column reconciler ───────────────────────────────
// Deploy migration is continue-on-error; the Worker self-heals.
let _columnsEnsured = false;
export async function ensureNsopwColumns(env: Bindings): Promise<void> {
  if (_columnsEnsured) return;
  const db = getDb(env);
  // The migration creates entire tables — there's no ADD COLUMN that
  // needs reconciliation today. But future revisions will need this
  // hook, so reserve it now and check at least that the tables exist.
  const t = await queryFirst<{ name: string }>(
    db, "SELECT name FROM sqlite_master WHERE type='table' AND name='national_sex_offenders'",
  ).catch(() => null);
  if (!t) {
    // Table missing on live — apply the minimum subset inline so the
    // route doesn't 500 before the operator runs the migration.
    try {
      await execute(db, `CREATE TABLE IF NOT EXISTS national_sex_offenders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nsopw_offender_id TEXT, jurisdiction TEXT, jurisdiction_label TEXT,
        first_name TEXT, middle_name TEXT, last_name TEXT, suffix TEXT,
        aliases TEXT, date_of_birth TEXT, sex TEXT, race TEXT,
        height TEXT, weight TEXT, hair_color TEXT, eye_color TEXT,
        scars_marks TEXT, address TEXT, city TEXT, state TEXT, zip TEXT,
        offense TEXT, risk_level TEXT, tier INTEGER, registration_status TEXT,
        compliance_status TEXT, photo_url TEXT, detail_url TEXT,
        detail_json TEXT, last_seen_at TEXT,
        absconder INTEGER DEFAULT 0, age INTEGER, locations_json TEXT,
        fetched_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')))`);
      await execute(db, `CREATE TABLE IF NOT EXISTS nsopw_query_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT, cache_key TEXT NOT NULL,
        query_surname TEXT, query_forename TEXT, query_dob TEXT,
        result_count INTEGER DEFAULT 0, hit_offender_ids TEXT,
        raw_response TEXT, jurisdiction_coverage TEXT,
        queried_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL)`);
      await execute(db, `CREATE TABLE IF NOT EXISTS nsopw_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'query',
        triggered_by TEXT, query_surname TEXT, query_forename TEXT, query_dob TEXT,
        cache_hit INTEGER DEFAULT 0, candidates_returned INTEGER DEFAULT 0,
        confirmed_matches INTEGER DEFAULT 0, possible_matches INTEGER DEFAULT 0,
        excluded_matches INTEGER DEFAULT 0, http_status INTEGER,
        latency_ms INTEGER, error TEXT,
        ran_at TEXT DEFAULT (datetime('now')))`);
      await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_nsopw_cache_key
        ON nsopw_query_cache(cache_key)`);
      await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_nsopw_jur_offender
        ON national_sex_offenders(jurisdiction, nsopw_offender_id)`);
      await execute(db, `INSERT OR IGNORE INTO screening_source_state
        (source_key, enabled) VALUES ('nsopw', 1)`).catch(() => {});
    } catch (err) {
      console.warn('[nsopw] runtime table create failed:', err);
    }
  }
  // Ensure middle_name on persons (already present in baseline schema,
  // but defensive — without it the persons SELECT in screenPersonForSor
  // would 500).
  if (!(await columnExists(db, 'persons', 'middle_name'))) {
    await execute(db, 'ALTER TABLE persons ADD COLUMN middle_name TEXT').catch(() => {});
  }
  // Mig 0147 adds absconder/age/locations_json on national_sex_offenders
  // + jurisdiction_stats_json on nsopw_runs (real wire fields discovered
  // during 2026-06-22 reconnaissance). Self-heal here.
  for (const col of [
    ['national_sex_offenders', 'absconder', 'INTEGER DEFAULT 0'],
    ['national_sex_offenders', 'age', 'INTEGER'],
    ['national_sex_offenders', 'locations_json', 'TEXT'],
    ['nsopw_runs', 'jurisdiction_stats_json', 'TEXT'],
  ] as const) {
    if (!(await columnExists(db, col[0], col[1]))) {
      await execute(db, `ALTER TABLE ${col[0]} ADD COLUMN ${col[1]} ${col[2]}`).catch(() => {});
    }
  }
  _columnsEnsured = true;
}
