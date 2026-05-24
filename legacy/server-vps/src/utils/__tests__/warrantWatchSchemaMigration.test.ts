// ============================================================
// Warrant Watch Log — Schema Migration Tests
// ============================================================
// Older production DBs were seeded with a strict CHECK
// constraint limiting `event` to two values. We later added
// 'potential_match' for DOB-boundary analyst review. SQLite
// has no ALTER TABLE … DROP CHECK, so the migration rebuilds
// the table. These tests verify:
//   1. Legacy CHECK is detected and dropped
//   2. Existing rows survive the rebuild
//   3. New event types insert successfully post-migration
//   4. Migration is idempotent (no-op on already-migrated DBs)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureWarrantWatchLogSchema,
  _resetWatchLogMigrationForTests,
} from '../utahWarrantScraper';

// `ensureWarrantWatchLogSchema` is typed against `getDb()`'s return value.
// Tests use raw better-sqlite3 instances; the API surface is identical.
type DbHandle = ReturnType<typeof Database>;

function makeLegacyDb(): DbHandle {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE warrant_watch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      person_name TEXT NOT NULL,
      event TEXT NOT NULL CHECK(event IN ('warrant_found', 'warrant_cleared')),
      utah_warrant_id TEXT,
      utah_person_id TEXT,
      court_name TEXT,
      case_id TEXT,
      charges TEXT,
      issue_date TEXT,
      scan_run_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      run_id INTEGER
    )
  `).run();
  return db;
}

function makeFreshDb(): DbHandle {
  const db = new Database(':memory:');
  // Mirrors database.ts current CREATE TABLE — no CHECK constraint.
  db.prepare(`
    CREATE TABLE warrant_watch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER,
      person_name TEXT,
      event TEXT NOT NULL,
      utah_warrant_id TEXT,
      utah_person_id TEXT,
      court_name TEXT,
      case_id TEXT,
      charges TEXT,
      issue_date TEXT,
      scan_run_id TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      run_id INTEGER
    )
  `).run();
  return db;
}

function tableSql(db: DbHandle): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='warrant_watch_log'")
    .get() as { sql: string };
  return row.sql;
}

describe('ensureWarrantWatchLogSchema — legacy DB migration', () => {
  beforeEach(() => _resetWatchLogMigrationForTests());

  it('drops the strict CHECK constraint on legacy schema', () => {
    const db = makeLegacyDb();
    expect(tableSql(db)).toMatch(/CHECK\s*\(\s*event\s+IN/i);

    ensureWarrantWatchLogSchema(db as any);

    expect(tableSql(db)).not.toMatch(/CHECK\s*\(\s*event\s+IN/i);
  });

  it('preserves existing rows during migration', () => {
    const db = makeLegacyDb();
    db.prepare(
      `INSERT INTO warrant_watch_log
        (person_id, person_name, event, utah_warrant_id, scan_run_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(42, 'Robert Brooks', 'warrant_found', 'UT-12345', 'run-1');

    ensureWarrantWatchLogSchema(db as any);

    const rows = db.prepare('SELECT * FROM warrant_watch_log').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].person_id).toBe(42);
    expect(rows[0].event).toBe('warrant_found');
  });

  it('allows potential_match inserts after migration', () => {
    const db = makeLegacyDb();
    ensureWarrantWatchLogSchema(db as any);

    expect(() =>
      db.prepare(
        `INSERT INTO warrant_watch_log
          (person_id, person_name, event, utah_warrant_id, scan_run_id)
         VALUES (?, ?, ?, ?, ?)`
      ).run(42, 'Jason Brown', 'potential_match', 'UT-9999', 'run-2')
    ).not.toThrow();
  });

  it('rebuilds expected indexes after migration', () => {
    const db = makeLegacyDb();
    ensureWarrantWatchLogSchema(db as any);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='warrant_watch_log'")
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_warrant_watch_log_person');
    expect(names).toContain('idx_warrant_watch_log_event');
    expect(names).toContain('idx_warrant_watch_log_run');
  });
});

describe('ensureWarrantWatchLogSchema — fresh DB no-op', () => {
  beforeEach(() => _resetWatchLogMigrationForTests());

  it('makes no schema changes on a DB without the legacy CHECK', () => {
    const db = makeFreshDb();
    const before = tableSql(db);

    ensureWarrantWatchLogSchema(db as any);

    expect(tableSql(db)).toBe(before);
  });

  it('is idempotent across multiple calls', () => {
    const db = makeLegacyDb();
    ensureWarrantWatchLogSchema(db as any);
    const afterFirst = tableSql(db);

    // Second call: process-cached flag short-circuits.
    ensureWarrantWatchLogSchema(db as any);
    expect(tableSql(db)).toBe(afterFirst);

    // Even after reset, second pass detects no CHECK and exits cleanly.
    _resetWatchLogMigrationForTests();
    expect(() => ensureWarrantWatchLogSchema(db as any)).not.toThrow();
    expect(tableSql(db)).toBe(afterFirst);
  });
});

describe('ensureWarrantWatchLogSchema — error handling', () => {
  beforeEach(() => _resetWatchLogMigrationForTests());

  it('does not throw when warrant_watch_log does not exist', () => {
    const db = new Database(':memory:');
    expect(() => ensureWarrantWatchLogSchema(db as any)).not.toThrow();
  });

  it('logs and continues if the migration query fails', () => {
    const db = makeLegacyDb();
    // Force a conflict so the migration aborts mid-flight.
    db.prepare('CREATE TABLE warrant_watch_log__new (x INTEGER)').run();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => ensureWarrantWatchLogSchema(db as any)).not.toThrow();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
