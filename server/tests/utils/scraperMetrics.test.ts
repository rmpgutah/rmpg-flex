import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  getSourceMetrics,
  computeHealthGrade,
  getHealthSummary,
} from '../../src/utils/scraperMetrics';

describe('scraperMetrics', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE warrant_scraper_config (
        source_key TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 1,
        circuit_broken INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 3
      );
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

  describe('computeHealthGrade', () => {
    it('returns F when no successes ever', () => {
      expect(computeHealthGrade(0, null, 3)).toBe('F');
    });

    it('returns A for fresh and high success rate', () => {
      const fresh = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      expect(computeHealthGrade(0.98, fresh, 3)).toBe('A');
    });

    it('returns F for stale even with high rate', () => {
      const stale = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      expect(computeHealthGrade(0.98, stale, 1)).toBe('F');
    });

    it('returns C for moderate success', () => {
      const fresh = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      expect(computeHealthGrade(0.6, fresh, 3)).toBe('C');
    });
  });

  describe('getSourceMetrics', () => {
    it('returns zero metrics when no runs', () => {
      const m = getSourceMetrics('unknown_source', 24, db);
      expect(m.total_runs).toBe(0);
      expect(m.success_rate).toBe(0);
      expect(m.health_grade).toBe('F');
    });

    it('computes success rate correctly', () => {
      const now = new Date().toISOString();
      const insert = db.prepare(
        `INSERT INTO warrant_scraper_runs
         (source_key, started_at, http_status, parsed_count, error_message, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      insert.run('src_a', now, 200, 5, null, 100);
      insert.run('src_a', now, 200, 3, null, 150);
      insert.run('src_a', now, 500, 0, 'boom', 200);

      const m = getSourceMetrics('src_a', 24, db);
      expect(m.total_runs).toBe(3);
      expect(m.successful_runs).toBe(2);
      expect(m.failed_runs).toBe(1);
      expect(m.success_rate).toBeCloseTo(2 / 3, 2);
    });

    it('computes p50 and p95 correctly', () => {
      const now = new Date().toISOString();
      const insert = db.prepare(
        `INSERT INTO warrant_scraper_runs
         (source_key, started_at, http_status, parsed_count, duration_ms)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (let i = 1; i <= 10; i++) {
        insert.run('src_p', now, 200, 1, i * 10);
      }
      const m = getSourceMetrics('src_p', 24, db);
      expect(m.p50_duration_ms).toBe(50);
      expect(m.p95_duration_ms).toBe(100);
    });

    it('counts unchanged runs separately', () => {
      const now = new Date().toISOString();
      const insert = db.prepare(
        `INSERT INTO warrant_scraper_runs
         (source_key, started_at, http_status, parsed_count, skipped_reason, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      insert.run('src_u', now, 304, 0, 'not_modified', 50);
      insert.run('src_u', now, 200, 0, 'content_unchanged', 60);

      const m = getSourceMetrics('src_u', 24, db);
      expect(m.unchanged_runs).toBe(2);
      expect(m.success_rate).toBe(1);
    });
  });

  describe('getHealthSummary', () => {
    it('aggregates grades across sources', () => {
      db.prepare('INSERT INTO warrant_scraper_config (source_key, enabled) VALUES (?, 1)').run(
        's1'
      );
      db.prepare('INSERT INTO warrant_scraper_config (source_key, enabled) VALUES (?, 1)').run(
        's2'
      );
      db.prepare(
        `INSERT INTO warrant_scraper_runs
         (source_key, started_at, http_status, parsed_count, duration_ms)
         VALUES (?, ?, ?, ?, ?)`
      ).run('s1', new Date().toISOString(), 200, 5, 100);

      const summary = getHealthSummary(db);
      expect(summary.total).toBe(2);
      expect(summary.healthy + summary.degraded + summary.failed).toBe(2);
    });
  });
});
