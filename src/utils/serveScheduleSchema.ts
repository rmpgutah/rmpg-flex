// ============================================================
// RMPG Flex — Serve attempt scheduler schema guards + migrations
// ============================================================
// Ensures serve_attempt_schedules is available before the cron fires.
// Provides safe DDL + introspection for live D1 deployments.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst, execute } from './db';

export interface SchemaCheckResult {
  table_exists: boolean;
  has_disposition_code: boolean;
  has_auto_replan_source: boolean;
  migration_name?: string;
  applied_at?: string;
}

// Verify schema readiness — called at startup and before each sweep.
export async function checkServeScheduleSchema(db: D1Database): Promise<SchemaCheckResult> {
  try {
    // Check table existence
    const tableCheck = await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='serve_attempt_schedules'`,
    ).catch(() => null);

    if (!tableCheck?.n) {
      return { table_exists: false, has_disposition_code: false, has_auto_replan_source: false };
    }

    // Check for new optional columns
    const [dispositionCol, replanCol] = await Promise.all([
      queryFirst<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM pragma_table_info('serve_attempt_schedules') WHERE name='disposition_code'`,
      ).catch(() => null),
      queryFirst<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM pragma_table_info('serve_attempt_schedules') WHERE name='auto_replan_source'`,
      ).catch(() => null),
    ]);

    return {
      table_exists: true,
      has_disposition_code: (dispositionCol?.n ?? 0) > 0,
      has_auto_replan_source: (replanCol?.n ?? 0) > 0,
    };
  } catch (err) {
    console.error('[serve-schedule] schema check failed:', err);
    return { table_exists: false, has_disposition_code: false, has_auto_replan_source: false };
  }
}

// Idempotent creation of serve_attempt_schedules (runs on first deploy).
// Uses IF NOT EXISTS so re-running is always safe.
export async function ensureServeScheduleSchema(db: D1Database): Promise<void> {
  try {
    await execute(
      db,
      `CREATE TABLE IF NOT EXISTS serve_attempt_schedules (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         queue_id INTEGER NOT NULL UNIQUE,
         attempt_number INTEGER NOT NULL,
         scheduled_date TEXT NOT NULL,
         window_start TEXT NOT NULL,
         window_end TEXT NOT NULL,
         window_label TEXT,
         notify_at TEXT NOT NULL,
         notify_before_secs INTEGER DEFAULT 1800,
         notified INTEGER DEFAULT 0,
         dismissed INTEGER DEFAULT 0,
         created_at TEXT DEFAULT datetime('now','localtime'),
         updated_at TEXT DEFAULT datetime('now','localtime'),
         
         FOREIGN KEY (queue_id) REFERENCES serve_queue(id) ON DELETE CASCADE,
         CHECK (attempt_number > 0),
         CHECK (notified IN (0,1)),
         CHECK (dismissed IN (0,1))
       )`,
    );
    console.log('[serve-schedule] table ensured');
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes('already exists')) {
      throw err;
    }
  }
}

// Safely add optional columns for future PRs (disposition_code, auto_replan_source, etc.)
// Only runs if column is missing — re-running is idempotent.
export async function addServeScheduleColumn(
  db: D1Database,
  columnName: string,
  columnDef: string,
): Promise<boolean> {
  try {
    const check = await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM pragma_table_info('serve_attempt_schedules') WHERE name=?`,
      columnName,
    ).catch(() => null);

    if ((check?.n ?? 0) > 0) {
      return true; // Already exists
    }

    await execute(db, `ALTER TABLE serve_attempt_schedules ADD COLUMN ${columnName} ${columnDef}`);
    console.log(`[serve-schedule] added column: ${columnName}`);
    return true;
  } catch (err) {
    console.error(`[serve-schedule] failed to add column ${columnName}:`, err);
    return false;
  }
}
