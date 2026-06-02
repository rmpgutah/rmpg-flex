import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst, execute } from '../db';
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
