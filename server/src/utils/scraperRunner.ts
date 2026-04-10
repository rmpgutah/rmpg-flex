// ============================================================
// Scraper Runner — Run tracking helper
// ============================================================
// Wraps syncSource() calls with start/complete/fail lifecycle
// that writes rows to warrant_scraper_runs. Exported so both
// the scheduler and the manual trigger API use the same code path.
// ============================================================

import Database from 'better-sqlite3';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';

export interface RunStartOptions {
  source_key: string;
  priority?: number;
}

export interface RunCompleteOptions {
  http_status?: number;
  bytes_received?: number;
  parsed_count?: number;
  inserted_count?: number;
  updated_count?: number;
  skipped_reason?: 'content_unchanged' | 'not_modified' | 'circuit_broken' | null;
  parser_used?: 'custom' | 'generic' | 'fallback';
}

export interface RunFailOptions {
  http_status?: number;
  error_message: string;
}

/**
 * Insert a new run row and return its ID.
 */
export function startRun(opts: RunStartOptions, dbOverride?: Database.Database): number {
  const db = dbOverride ?? getDb();
  const result = db
    .prepare('INSERT INTO warrant_scraper_runs (source_key, started_at) VALUES (?, ?)')
    .run(opts.source_key, localNow());
  return result.lastInsertRowid as number;
}

/**
 * Compute the elapsed milliseconds since the given run started.
 * Returns 0 if the row is missing.
 */
function computeDuration(db: Database.Database, runId: number): number {
  const row = db
    .prepare('SELECT started_at FROM warrant_scraper_runs WHERE id = ?')
    .get(runId) as { started_at: string } | undefined;
  if (!row) return 0;
  const startMs = new Date(row.started_at).getTime();
  if (isNaN(startMs)) return 0;
  return Date.now() - startMs;
}

/**
 * Finalize a run as successful, recording status, byte counts, and parse results.
 */
export function completeRun(
  runId: number,
  opts: RunCompleteOptions,
  dbOverride?: Database.Database
): void {
  const db = dbOverride ?? getDb();
  const durationMs = computeDuration(db, runId);

  db.prepare(
    `UPDATE warrant_scraper_runs
     SET finished_at = ?,
         duration_ms = ?,
         http_status = ?,
         bytes_received = ?,
         parsed_count = ?,
         inserted_count = ?,
         updated_count = ?,
         skipped_reason = ?,
         parser_used = ?
     WHERE id = ?`
  ).run(
    localNow(),
    durationMs,
    opts.http_status ?? null,
    opts.bytes_received ?? null,
    opts.parsed_count ?? 0,
    opts.inserted_count ?? 0,
    opts.updated_count ?? 0,
    opts.skipped_reason ?? null,
    opts.parser_used ?? null,
    runId
  );
}

/**
 * Finalize a run as failed, recording the error message and HTTP status.
 */
export function failRun(
  runId: number,
  opts: RunFailOptions,
  dbOverride?: Database.Database
): void {
  const db = dbOverride ?? getDb();
  const durationMs = computeDuration(db, runId);

  db.prepare(
    `UPDATE warrant_scraper_runs
     SET finished_at = ?,
         duration_ms = ?,
         http_status = ?,
         error_message = ?
     WHERE id = ?`
  ).run(localNow(), durationMs, opts.http_status ?? null, opts.error_message, runId);
}

/**
 * Delete all run rows except the most recent N per source_key.
 * Returns the number of rows deleted.
 */
export function pruneRuns(
  keepPerSource: number = 500,
  dbOverride?: Database.Database
): { deleted: number } {
  const db = dbOverride ?? getDb();
  const result = db
    .prepare(
      `DELETE FROM warrant_scraper_runs
       WHERE id NOT IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY source_key ORDER BY started_at DESC) AS rn
           FROM warrant_scraper_runs
         ) WHERE rn <= ?
       )`
    )
    .run(keepPerSource);
  return { deleted: result.changes };
}
