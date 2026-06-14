import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst, execute, executeBatch } from '../db';
import type { RawWarrantHit } from './types';

// ============================================================
// Generic scraped_warrants store
// ------------------------------------------------------------
// Persistence layer for ALL non-Utah (scraped) warrant sources.
// Utah keeps its own utah_warrants table + poller path; this is
// the generic store the orchestrator writes for Ada / Natrona /
// future sources. Each row is scoped by source_key, keyed by the
// source's stable (source_key, warrant_id) pair. The reconcile
// step reads across both tables.
//
// Mirrors the shipped utahWarrantPoller patterns: recordWarrant's
// seen-at refresh semantics and markClearedWarrants' datetime()
// normalisation — but uses SELECT-then-INSERT/UPDATE (like
// syncLocalWarrantRecord) instead of ON CONFLICT, so it does NOT
// depend on a UNIQUE index on (source_key, warrant_id) that may
// not exist on the live table yet.
// ============================================================

/**
 * Upsert a hit into scraped_warrants. Idempotent on (source_key, warrant_id):
 * insert sets first_seen_at + scraped_at + last_seen_at = datetime('now'),
 * status='active', cleared_at=NULL; on conflict refresh last_seen_at +
 * scraped_at + status='active' + cleared_at=NULL + the mutable detail fields
 * (charge/court/case/bail/issue/age/full_name/...). person_id is set/refreshed.
 *
 * Implemented as SELECT-then-INSERT/UPDATE (no ON CONFLICT) to stay robust
 * without a unique index on (source_key, warrant_id).
 */
export async function upsertScrapedWarrant(
  db: D1Database,
  hit: RawWarrantHit,
  personId: number | null,
): Promise<void> {
  // RawWarrantHit carries only a subset of the scraped_warrants columns;
  // gender/race/offense_level/status/dob_verified are populated by later
  // phases (detail fetches / normalizer) and stay null/unset here.
  const fullName =
    hit.full_name ?? ([hit.first_name, hit.last_name].filter(Boolean).join(' ').trim() || null);

  const existing = await queryFirst<{ id: number }>(
    db,
    'SELECT id FROM scraped_warrants WHERE source_key = ? AND warrant_id = ?',
    hit.source_key, hit.warrant_id,
  );

  if (existing) {
    await execute(
      db,
      `UPDATE scraped_warrants SET
         status = 'active', cleared_at = NULL,
         last_seen_at = datetime('now'), scraped_at = datetime('now'),
         full_name = ?, first_name = ?, last_name = ?, middle_name = ?,
         date_of_birth = ?, age = ?, city = ?, state = ?,
         warrant_type = ?, charge_description = ?, court_name = ?,
         case_number = ?, bail_amount = ?, issue_date = ?,
         photo_url = ?, detail_url = ?, person_id = ?
       WHERE id = ?`,
      fullName,
      hit.first_name ?? null,
      hit.last_name ?? null,
      hit.middle_name ?? null,
      hit.date_of_birth ?? null,
      hit.age ?? null,
      hit.city ?? null,
      hit.state ?? null,
      hit.warrant_type ?? null,
      hit.charge_description ?? null,
      hit.court_name ?? null,
      hit.case_number ?? null,
      hit.bail_amount ?? null,
      hit.issue_date ?? null,
      hit.photo_url ?? null,
      hit.detail_url ?? null,
      personId ?? null,
      existing.id,
    );
    return;
  }

  await execute(
    db,
    `INSERT INTO scraped_warrants (
       source_key, warrant_id, full_name, first_name, last_name, middle_name,
       date_of_birth, age, city, state, warrant_type, charge_description,
       court_name, case_number, bail_amount, issue_date, photo_url, detail_url,
       person_id, status, cleared_at, first_seen_at, last_seen_at, scraped_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       'active', NULL, datetime('now'), datetime('now'), datetime('now'))`,
    hit.source_key,
    hit.warrant_id,
    fullName,
    hit.first_name ?? null,
    hit.last_name ?? null,
    hit.middle_name ?? null,
    hit.date_of_birth ?? null,
    hit.age ?? null,
    hit.city ?? null,
    hit.state ?? null,
    hit.warrant_type ?? null,
    hit.charge_description ?? null,
    hit.court_name ?? null,
    hit.case_number ?? null,
    hit.bail_amount ?? null,
    hit.issue_date ?? null,
    hit.photo_url ?? null,
    hit.detail_url ?? null,
    personId ?? null,
  );
}

/**
 * Mark rows of ONE source cleared when NOT seen since runStartedAt. MUST use
 * datetime() on BOTH sides. Sets status='cleared', cleared_at=datetime('now')
 * for is-now-stale active rows. Returns count cleared.
 *
 * CRITICAL — datetime FORMAT NORMALISATION. `last_seen_at` is written via
 * SQLite's `datetime('now')` (`YYYY-MM-DD HH:MM:SS`, SPACE separator) while
 * `runStartedAt` is a JS `toISOString()` string (`YYYY-MM-DDTHH:MM:SS.sssZ`,
 * T separator). A raw TEXT `<` compare sorts a space (0x20) before 'T' (0x54)
 * at index 10, so every space-formatted row compares "less than" any
 * T-formatted start — clearing EVERY row on every run. Wrapping BOTH sides in
 * datetime() reduces them to the same canonical form for a true chronological
 * comparison.
 */
export async function markScrapedCleared(
  db: D1Database,
  sourceKey: string,
  runStartedAt: string,
): Promise<number> {
  const result = await execute(
    db,
    `UPDATE scraped_warrants SET status='cleared', cleared_at=datetime('now')
      WHERE source_key = ?
        AND status='active'
        AND datetime(last_seen_at) < datetime(?)`,
    sourceKey, runStartedAt,
  );
  return result.meta?.changes ?? 0;
}

// ── Per-source pagination progress (chunked full-list ingestion) ─────────────

export interface SourceProgress {
  cursor: string | null;
  cycle_started_at: string | null;
  rows_this_cycle: number;
}

/** Read a source's pagination progress, or null if it has never run. */
export async function readSourceProgress(db: D1Database, sourceKey: string): Promise<SourceProgress | null> {
  return queryFirst<SourceProgress>(
    db,
    'SELECT cursor, cycle_started_at, rows_this_cycle FROM national_warrant_source_progress WHERE source_key = ?',
    sourceKey,
  );
}

/** Advance progress mid-cycle: persist the new cursor + running count, keeping
 *  the current cycle_started_at. Keyed by the source_key PRIMARY KEY. */
export async function saveSourceProgress(
  db: D1Database,
  sourceKey: string,
  cursor: string | null,
  cycleStartedAt: string,
  rowsThisCycle: number,
): Promise<void> {
  await execute(
    db,
    `INSERT INTO national_warrant_source_progress
       (source_key, cursor, cycle_started_at, rows_this_cycle, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(source_key) DO UPDATE SET
       cursor = excluded.cursor,
       cycle_started_at = excluded.cycle_started_at,
       rows_this_cycle = excluded.rows_this_cycle,
       updated_at = datetime('now')`,
    sourceKey, cursor, cycleStartedAt, rowsThisCycle,
  );
}

/** Complete a full pass: reset cursor to NULL, start the next cycle's timestamp,
 *  stamp last_full_cycle_at, and zero the running count. */
export async function completeSourceCycle(
  db: D1Database,
  sourceKey: string,
  newCycleStartedAt: string,
): Promise<void> {
  await execute(
    db,
    `INSERT INTO national_warrant_source_progress
       (source_key, cursor, cycle_started_at, last_full_cycle_at, rows_this_cycle, updated_at)
     VALUES (?, NULL, ?, datetime('now'), 0, datetime('now'))
     ON CONFLICT(source_key) DO UPDATE SET
       cursor = NULL,
       cycle_started_at = excluded.cycle_started_at,
       last_full_cycle_at = datetime('now'),
       rows_this_cycle = 0,
       updated_at = datetime('now')`,
    sourceKey, newCycleStartedAt,
  );
}

// ── Batched upsert (chunked full-list ingestion) ─────────────────────────────
// Relies on the UNIQUE index on (source_key, warrant_id) so it can use ON CONFLICT
// in a D1 batch() — orders of magnitude fewer round-trips than the per-row
// SELECT-then-write upsertScrapedWarrant (kept for the per-person leg). Sub-batched
// so one bad statement-set can't abort the rest.
// NOTE: this column list mirrors upsertScrapedWarrant's INSERT above. If you add
// a column to one, add it to the other.
const SCRAPED_UPSERT_SQL = `
  INSERT INTO scraped_warrants (
    source_key, warrant_id, full_name, first_name, last_name, middle_name,
    date_of_birth, age, city, state, warrant_type, charge_description,
    court_name, case_number, bail_amount, issue_date, photo_url, detail_url,
    person_id, status, cleared_at, first_seen_at, last_seen_at, scraped_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    'active', NULL, datetime('now'), datetime('now'), datetime('now'))
  ON CONFLICT(source_key, warrant_id) DO UPDATE SET
    status='active', cleared_at=NULL,
    last_seen_at=datetime('now'), scraped_at=datetime('now'),
    full_name=excluded.full_name, first_name=excluded.first_name,
    last_name=excluded.last_name, middle_name=excluded.middle_name,
    date_of_birth=excluded.date_of_birth, age=excluded.age,
    city=excluded.city, state=excluded.state,
    warrant_type=excluded.warrant_type, charge_description=excluded.charge_description,
    court_name=excluded.court_name, case_number=excluded.case_number,
    bail_amount=excluded.bail_amount, issue_date=excluded.issue_date,
    photo_url=excluded.photo_url, detail_url=excluded.detail_url,
    person_id=excluded.person_id`;

/**
 * Batched upsert of full-list hits. D1 batch() is all-or-nothing per 100-row
 * slice, so a failed slice counts ALL its rows as errors (never throws). There is
 * NO per-row fallback here — callers MUST treat `errors > 0` as a failed chunk and
 * neither advance the cursor nor run the clear-sweep (see runFullListLeg's gate).
 */
export async function upsertScrapedWarrantsBatch(
  db: D1Database,
  hits: RawWarrantHit[],
  personId: number | null,
): Promise<{ found: number; errors: number }> {
  let found = 0;
  let errors = 0;
  const BATCH = 100;
  for (let i = 0; i < hits.length; i += BATCH) {
    const slice = hits.slice(i, i + BATCH);
    const statements = slice.map((h) => {
      const fullName = h.full_name ?? ([h.first_name, h.last_name].filter(Boolean).join(' ').trim() || null);
      return {
        sql: SCRAPED_UPSERT_SQL,
        bindings: [
          h.source_key, h.warrant_id, fullName, h.first_name ?? null, h.last_name ?? null, h.middle_name ?? null,
          h.date_of_birth ?? null, h.age ?? null, h.city ?? null, h.state ?? null, h.warrant_type ?? null,
          h.charge_description ?? null, h.court_name ?? null, h.case_number ?? null, h.bail_amount ?? null,
          h.issue_date ?? null, h.photo_url ?? null, h.detail_url ?? null, personId ?? null,
        ],
      };
    });
    try {
      await executeBatch(db, statements);
      found += slice.length;
    } catch (err) {
      errors += slice.length;
      console.warn(
        `[warrantSources.store] batch upsert failed (${slice.length} rows):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return { found, errors };
}
