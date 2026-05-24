import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureWarrantReviewColumns,
  ensureWarrantIndexes,
  _resetEnsuredForTests,
} from '../../src/utils/warrantHelpers';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE warrants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warrant_number TEXT,
      priority_score INTEGER DEFAULT 0,
      issue_date TEXT,
      subject_person_id INTEGER,
      source TEXT
    )
  `).run();
  return db;
}

function hasColumn(db: Database.Database, col: string): boolean {
  const rows = db.prepare('PRAGMA table_info(warrants)').all() as {
    name: string;
  }[];
  return rows.some((r) => r.name === col);
}

function hasIndex(db: Database.Database, idx: string): boolean {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
    .all(idx) as { name: string }[];
  return rows.length > 0;
}

describe('ensureWarrantReviewColumns', () => {
  beforeEach(() => _resetEnsuredForTests());

  it('adds reviewed_at, reviewed_by, last_scraped_at on fresh schema', () => {
    const db = makeDb();
    expect(hasColumn(db, 'reviewed_at')).toBe(false);
    ensureWarrantReviewColumns(db);
    expect(hasColumn(db, 'reviewed_at')).toBe(true);
    expect(hasColumn(db, 'reviewed_by')).toBe(true);
    expect(hasColumn(db, 'last_scraped_at')).toBe(true);
  });

  it('is idempotent on second call', () => {
    const db = makeDb();
    ensureWarrantReviewColumns(db);
    expect(() => ensureWarrantReviewColumns(db)).not.toThrow();
    expect(hasColumn(db, 'reviewed_at')).toBe(true);
  });

  it('is idempotent when columns already exist', () => {
    const db = makeDb();
    db.prepare('ALTER TABLE warrants ADD COLUMN reviewed_at TEXT').run();
    _resetEnsuredForTests();
    expect(() => ensureWarrantReviewColumns(db)).not.toThrow();
  });

  it('silently handles missing table', () => {
    const db = new Database(':memory:');
    expect(() => ensureWarrantReviewColumns(db)).not.toThrow();
  });
});

describe('ensureWarrantIndexes', () => {
  beforeEach(() => _resetEnsuredForTests());

  it('adds all 5 indexes on fresh schema', () => {
    const db = makeDb();
    // Columns must exist before indexes can reference them — mirrors
    // production ordering where handlers call ensureWarrantReviewColumns
    // before ensureWarrantIndexes.
    ensureWarrantReviewColumns(db);
    ensureWarrantIndexes(db);
    expect(hasIndex(db, 'idx_warrants_priority')).toBe(true);
    expect(hasIndex(db, 'idx_warrants_issue_date')).toBe(true);
    expect(hasIndex(db, 'idx_warrants_subject_person')).toBe(true);
    expect(hasIndex(db, 'idx_warrants_source')).toBe(true);
    expect(hasIndex(db, 'idx_warrants_last_scraped')).toBe(true);
  });

  it('is idempotent', () => {
    const db = makeDb();
    ensureWarrantReviewColumns(db);
    ensureWarrantIndexes(db);
    expect(() => ensureWarrantIndexes(db)).not.toThrow();
  });
});
