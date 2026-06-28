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

const DEFAULT_INTERVAL_DAYS = 180; // ~6 months

// Per-source cadence gate (orthogonal to enabled/circuit-breaker).
// A source is "due" when:
//   - force is set (manual trigger / new-source kick), OR
//   - it has never been scheduled (next_run_at empty → brand-new source → run now), OR
//   - its scheduled next_run_at has already passed.
// next_run_at is D1's `datetime('now', ...)` form: "YYYY-MM-DD HH:MM:SS" in UTC.
export function isSourceDue(nextRunAt: string | null | undefined, nowMs: number, force = false): boolean {
  if (force) return true;
  if (!nextRunAt) return true; // never scheduled → new source → immediate
  const iso = nextRunAt.includes('T') ? nextRunAt : `${nextRunAt.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true; // unparseable → fail open (run)
  return t <= nowMs;
}

// Reconcile the per-source cadence columns at runtime — the deploy migration
// step is continue-on-error, so the Worker cannot assume the migration landed.
// Idempotent: a duplicate-column error on re-run is swallowed.
let scheduleColumnsEnsured = false;
async function ensureScreeningScheduleColumns(env: Bindings): Promise<void> {
  if (scheduleColumnsEnsured) return;
  const db = getDb(env);
  for (const ddl of [
    'ALTER TABLE screening_source_state ADD COLUMN scan_interval_days INTEGER NOT NULL DEFAULT 180',
    'ALTER TABLE screening_source_state ADD COLUMN next_run_at TEXT',
  ]) {
    await execute(db, ddl).catch(() => {}); // already exists → ignore
  }
  scheduleColumnsEnsured = true;
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

async function runOne(env: Bindings, adapter: ScreeningAdapter, force = false): Promise<void> {
  if (!adapter.supportsWatch) return;            // Fix 3: cheap static check first
  const db = getDb(env);
  const state = await queryFirst<SourceRunState & { next_run_at: string | null; scan_interval_days: number | null }>(db,
    `SELECT enabled, circuit_broken, next_run_at, scan_interval_days,
            (julianday('now') - julianday(last_run_at)) * 24 AS hours_since_run
       FROM screening_source_state WHERE source_key = ?`, adapter.sourceKey).catch(() => null);
  if (!shouldRunSource(state)) return;           // disabled or cooling down
  // A tripped source whose cooldown has elapsed gets a half-open retry that
  // bypasses the cadence gate; otherwise respect the per-source interval.
  const halfOpen = state?.circuit_broken === 1;
  if (!force && !halfOpen && !isSourceDue(state?.next_run_at, Date.now())) return;

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
  // Stamp the next scheduled run = now + the source's interval (default ~6 months),
  // which OVERRIDES the global 4h scan for this source. Upsert so a brand-new
  // source (no seeded state row) gets one on its first scrape.
  await execute(db, `
    INSERT INTO screening_source_state (source_key, enabled, last_run_at, last_success_at, circuit_broken, scan_interval_days, next_run_at)
    VALUES (?, 1, datetime('now'), datetime('now'), 0, ?, datetime('now', '+' || ? || ' days'))
    ON CONFLICT(source_key) DO UPDATE SET
      last_run_at = datetime('now'),
      last_success_at = datetime('now'),
      circuit_broken = 0,
      next_run_at = datetime('now', '+' || COALESCE(screening_source_state.scan_interval_days, ?) || ' days')`,
    adapter.sourceKey, DEFAULT_INTERVAL_DAYS, DEFAULT_INTERVAL_DAYS, DEFAULT_INTERVAL_DAYS);
}

export interface RunScreeningOpts {
  // Manual trigger: bypass the per-source cadence gate and scrape now.
  force?: boolean;
  // Limit the run to a single source (used by the per-source "Scrape now" button).
  sourceKey?: string;
}

export async function runScreeningScans(env: Bindings, opts: RunScreeningOpts = {}): Promise<void> {
  await ensureScreeningScheduleColumns(env).catch(() => {});
  try {
    const age = await ofacDataAgeHours(env);
    if (age == null || age > 20) await ingestOfac(env);
  } catch (err) { console.error('[screening] ofac ingest failed:', err); }

  const adapters = opts.sourceKey
    ? getAdapters().filter((a) => a.sourceKey === opts.sourceKey)
    : getAdapters();
  for (const adapter of adapters) {
    try { await runOne(env, adapter, opts.force ?? false); }
    catch (err) {
      console.error(`[screening] ${adapter.sourceKey} scan failed:`, err);
      await execute(getDb(env), "UPDATE screening_source_state SET last_error=?, circuit_broken=1, last_run_at=datetime('now') WHERE source_key=?",
        err instanceof Error ? (err.stack ?? err.message) : String(err), adapter.sourceKey).catch(() => {});
    }
  }
}
