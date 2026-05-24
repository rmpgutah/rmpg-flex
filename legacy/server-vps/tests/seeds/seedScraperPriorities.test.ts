import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { seedScraperPriorities } from '../../src/seeds/seedScraperPriorities';

describe('seedScraperPriorities', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE warrant_scraper_config (
        source_key TEXT PRIMARY KEY,
        state TEXT,
        priority INTEGER DEFAULT 3
      );
      INSERT INTO warrant_scraper_config (source_key, state) VALUES
        ('fed_fbi_wanted', 'US'),
        ('ut_slc_metro_warrants', 'UT'),
        ('co_denver_warrants', 'CO'),
        ('ak_anchorage_warrants', 'AK'),
        ('normal_county_warrants', 'CA');
    `);
  });

  const getPriority = (key: string): number => {
    const row = db.prepare('SELECT priority FROM warrant_scraper_config WHERE source_key = ?').get(key) as { priority: number };
    return row.priority;
  };

  it('assigns tier 1 to FBI', () => {
    seedScraperPriorities(db);
    expect(getPriority('fed_fbi_wanted')).toBe(1);
  });

  it('assigns tier 1 to SLC metro', () => {
    seedScraperPriorities(db);
    expect(getPriority('ut_slc_metro_warrants')).toBe(1);
  });

  it('assigns tier 2 to Denver', () => {
    seedScraperPriorities(db);
    expect(getPriority('co_denver_warrants')).toBe(2);
  });

  it('assigns tier 4 to Alaska', () => {
    seedScraperPriorities(db);
    expect(getPriority('ak_anchorage_warrants')).toBe(4);
  });

  it('leaves unknown sources at tier 3', () => {
    seedScraperPriorities(db);
    expect(getPriority('normal_county_warrants')).toBe(3);
  });

  it('reports correct updated count', () => {
    const result = seedScraperPriorities(db);
    expect(result.updated).toBe(4);
  });

  it('is idempotent — second run updates 0 rows', () => {
    const first = seedScraperPriorities(db);
    const second = seedScraperPriorities(db);
    expect(first.updated).toBe(4);
    expect(second.updated).toBe(0);
  });

  it('handles rows with NULL state without error', () => {
    // Insert a row with NULL state — should stay at tier 3
    db.prepare(`INSERT INTO warrant_scraper_config (source_key, state) VALUES ('weird_source', NULL)`).run();
    const result = seedScraperPriorities(db);
    const row = db.prepare(`SELECT priority FROM warrant_scraper_config WHERE source_key = 'weird_source'`).get() as { priority: number };
    expect(row.priority).toBe(3); // unchanged
  });
});
