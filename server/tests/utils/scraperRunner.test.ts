import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { startRun, completeRun, failRun, pruneRuns } from '../../src/utils/scraperRunner';

describe('scraperRunner', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE warrant_scraper_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        http_status INTEGER,
        bytes_received INTEGER,
        parsed_count INTEGER DEFAULT 0,
        inserted_count INTEGER DEFAULT 0,
        updated_count INTEGER DEFAULT 0,
        skipped_reason TEXT,
        error_message TEXT,
        parser_used TEXT
      );
    `);
  });

  it('startRun inserts a row and returns its ID', () => {
    const id = startRun({ source_key: 'test_source' }, db);
    expect(id).toBeGreaterThan(0);

    const row = db.prepare('SELECT * FROM warrant_scraper_runs WHERE id = ?').get(id) as any;
    expect(row).toBeDefined();
    expect(row.source_key).toBe('test_source');
    expect(row.started_at).toBeTruthy();
    expect(row.finished_at).toBeNull();
  });

  it('completeRun updates the row with status and counts', () => {
    const id = startRun({ source_key: 'test_source' }, db);
    completeRun(
      id,
      {
        http_status: 200,
        bytes_received: 1024,
        parsed_count: 10,
        inserted_count: 3,
        updated_count: 7,
        parser_used: 'custom',
      },
      db
    );

    const row = db.prepare('SELECT * FROM warrant_scraper_runs WHERE id = ?').get(id) as any;
    expect(row.http_status).toBe(200);
    expect(row.bytes_received).toBe(1024);
    expect(row.parsed_count).toBe(10);
    expect(row.inserted_count).toBe(3);
    expect(row.updated_count).toBe(7);
    expect(row.parser_used).toBe('custom');
    expect(row.finished_at).not.toBeNull();
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('completeRun with skipped_reason records no parse', () => {
    const id = startRun({ source_key: 'test_source' }, db);
    completeRun(id, { http_status: 304, skipped_reason: 'not_modified' }, db);

    const row = db.prepare('SELECT * FROM warrant_scraper_runs WHERE id = ?').get(id) as any;
    expect(row.http_status).toBe(304);
    expect(row.skipped_reason).toBe('not_modified');
    expect(row.parsed_count).toBe(0);
  });

  it('failRun records error message', () => {
    const id = startRun({ source_key: 'test_source' }, db);
    failRun(id, { http_status: 500, error_message: 'Server error' }, db);

    const row = db.prepare('SELECT * FROM warrant_scraper_runs WHERE id = ?').get(id) as any;
    expect(row.error_message).toBe('Server error');
    expect(row.http_status).toBe(500);
    expect(row.finished_at).not.toBeNull();
  });

  it('pruneRuns keeps only N most recent per source', () => {
    const insert = db.prepare(
      'INSERT INTO warrant_scraper_runs (source_key, started_at) VALUES (?, ?)'
    );
    for (let i = 0; i < 10; i++) {
      const ts = db
        .prepare("SELECT datetime('now', '-' || ? || ' minutes') AS t")
        .get(i) as { t: string };
      insert.run('source_a', ts.t);
    }
    for (let i = 0; i < 5; i++) {
      const ts = db
        .prepare("SELECT datetime('now', '-' || ? || ' minutes') AS t")
        .get(i) as { t: string };
      insert.run('source_b', ts.t);
    }

    const result = pruneRuns(3, db);
    expect(result.deleted).toBe(9);

    const aCount = db
      .prepare("SELECT COUNT(*) AS c FROM warrant_scraper_runs WHERE source_key = 'source_a'")
      .get() as { c: number };
    const bCount = db
      .prepare("SELECT COUNT(*) AS c FROM warrant_scraper_runs WHERE source_key = 'source_b'")
      .get() as { c: number };
    expect(aCount.c).toBe(3);
    expect(bCount.c).toBe(3);
  });
});
