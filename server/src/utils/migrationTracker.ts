// Improvement 67: Database migration version tracker
import { getDb } from '../models/database';
import { logger } from './logger';

interface MigrationRecord {
  id: number;
  name: string;
  appliedAt: string;
  durationMs: number;
  status: 'success' | 'failure';
}

/** Initialize the migration tracking table */
export function initMigrationTracker(): void {
  try {
    const db = getDb();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS _migration_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        duration_ms INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'success',
        error_message TEXT
      )
    `).run();
  } catch (err) {
    logger.warn({ err }, 'Could not initialize migration tracker');
  }
}

/** Record a migration execution */
export function recordMigration(name: string, durationMs: number, status: 'success' | 'failure', errorMessage?: string): void {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO _migration_log (name, duration_ms, status, error_message) VALUES (?, ?, ?, ?)'
    ).run(name, Math.round(durationMs), status, errorMessage || null);
  } catch {
    // Don't fail if tracking fails
  }
}

/** Get all recorded migrations */
export function getMigrationHistory(): MigrationRecord[] {
  try {
    const db = getDb();
    return db.prepare(
      'SELECT id, name, applied_at as appliedAt, duration_ms as durationMs, status FROM _migration_log ORDER BY id DESC LIMIT 100'
    ).all() as MigrationRecord[];
  } catch {
    return [];
  }
}

/** Get the latest migration */
export function getLatestMigration(): MigrationRecord | null {
  try {
    const db = getDb();
    return (db.prepare(
      'SELECT id, name, applied_at as appliedAt, duration_ms as durationMs, status FROM _migration_log ORDER BY id DESC LIMIT 1'
    ).get() as MigrationRecord) || null;
  } catch {
    return null;
  }
}

/** Get count of applied migrations */
export function getMigrationCount(): number {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as cnt FROM _migration_log WHERE status = ?').get('success') as any;
    return row?.cnt || 0;
  } catch {
    return 0;
  }
}
