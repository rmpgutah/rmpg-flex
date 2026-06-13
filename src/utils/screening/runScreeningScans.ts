import type { Bindings } from '../../types';
import type { PersonRow, ScreeningAdapter } from './types';
import { getDb, query, queryFirst, execute } from '../db';
import { getAdapters } from './registry';
import { ofacDataAgeHours, ingestOfac } from './ofacAdapter';

const DEFAULT_MAX = 10;

export interface SourceRunState {
  enabled: number;
  circuit_broken: number;
  hours_since_run: number | null;
}

// Decide whether to run a source this cron tick.
// - enabled=0 → never (deliberately disabled)
// - circuit broken → skip during a cooldown window, then allow a half-open retry
// - otherwise → run
export function shouldRunSource(state: SourceRunState | null, cooldownHours = 3): boolean {
  if (!state) return true;
  if (state.enabled === 0) return false;
  if (state.circuit_broken === 1) {
    if (state.hours_since_run == null) return true;
    return state.hours_since_run >= cooldownHours;
  }
  return true;
}

async function watchPopulation(env: Bindings, sourceKey: string): Promise<PersonRow[]> {
  const db = getDb(env);
  const rows = await query<PersonRow>(db, `
    SELECT p.id, p.first_name, p.middle_name, p.last_name, p.dob, p.citizenship
      FROM persons p
     WHERE p.id IN (
        SELECT entity_id FROM intel_watchlist WHERE entity_type='person' AND active=1
        UNION
        SELECT person_id FROM screening_watchlist WHERE active=1 AND (source_scope IS NULL OR source_scope = ?)
     )
     ORDER BY p.id LIMIT 500`, sourceKey).catch(() => []);
  return rows;
}

async function configInt(env: Bindings, key: string, fallback: number): Promise<number> {
  const row = await queryFirst<{ config_value: string }>(getDb(env),
    'SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1', key).catch(() => null);
  const n = row ? parseInt(row.config_value, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

async function runOne(env: Bindings, adapter: ScreeningAdapter): Promise<void> {
  if (!adapter.supportsWatch) return;            // Fix 3: cheap static check first
  const db = getDb(env);
  const state = await queryFirst<SourceRunState>(db,
    `SELECT enabled, circuit_broken, (julianday('now') - julianday(last_run_at)) * 24 AS hours_since_run
       FROM screening_source_state WHERE source_key = ?`, adapter.sourceKey).catch(() => null);
  if (!shouldRunSource(state)) return;

  const run = await execute(db, 'INSERT INTO screening_scan_runs (source_key) VALUES (?)', adapter.sourceKey);
  const runId = run.meta.last_row_id;
  let checked = 0, newHits = 0, errors = 0;
  const threshold = (await configInt(env, `screening_${adapter.sourceKey.replace(/-/g, '_')}_min_score`, 80)) / 100;
  const max = await configInt(env, `screening_${adapter.sourceKey.replace(/-/g, '_')}_max_per_run`, DEFAULT_MAX);

  const persons = await watchPopulation(env, adapter.sourceKey);
  const slice = adapter.kind === 'notice' ? persons.slice(0, max) : persons;

  for (const person of slice) {
    try {
      checked++;
      const candidates = await adapter.fetchForPerson(env, person);
      for (const cand of candidates) {
        if (!cand.externalId) continue;
        const m = adapter.scoreMatch(person, cand);
        if (m.score < threshold) continue;
        const existing = await queryFirst<{ id: number; status: string }>(db,
          'SELECT id, status FROM screening_hits WHERE source_key=? AND person_id=? AND external_id=?',
          adapter.sourceKey, person.id, cand.externalId);
        if (existing) {
          await execute(db, "UPDATE screening_hits SET last_seen_at=datetime('now'), match_score=?, is_active=1 WHERE id=?", m.score, existing.id);
        } else {
          await execute(db, `INSERT INTO screening_hits
              (source_key, person_id, external_id, match_score, matched_fields, status,
               display_name, summary, photo_url, country, list_type, raw_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            adapter.sourceKey, person.id, cand.externalId, m.score, JSON.stringify(m.matchedFields), 'pending',
            cand.displayName, cand.summary, cand.photoUrl ?? null, cand.country ?? null, cand.listType ?? null, JSON.stringify(cand.raw));
          newHits++;
        }
      }
    } catch (err) { errors++; console.warn(`[screening] ${adapter.sourceKey} person ${person.id} error:`, err); }
  }

  await execute(db, "UPDATE screening_scan_runs SET finished_at=datetime('now'), persons_checked=?, new_hits=?, errors=? WHERE id=?",
    checked, newHits, errors, runId);
  await execute(db, "UPDATE screening_source_state SET last_run_at=datetime('now'), last_success_at=datetime('now'), circuit_broken=0 WHERE source_key=?", adapter.sourceKey);
}

export async function runScreeningScans(env: Bindings): Promise<void> {
  try {
    const age = await ofacDataAgeHours(env);
    if (age == null || age > 20) await ingestOfac(env);
  } catch (err) { console.error('[screening] ofac ingest failed:', err); }

  for (const adapter of getAdapters()) {
    try { await runOne(env, adapter); }
    catch (err) {
      console.error(`[screening] ${adapter.sourceKey} scan failed:`, err);
      await execute(getDb(env), "UPDATE screening_source_state SET last_error=?, circuit_broken=1, last_run_at=datetime('now') WHERE source_key=?",
        err instanceof Error ? (err.stack ?? err.message) : String(err), adapter.sourceKey).catch(() => {});
    }
  }
}
