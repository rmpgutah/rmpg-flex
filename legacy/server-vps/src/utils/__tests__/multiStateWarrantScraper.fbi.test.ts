// ============================================================
// Multi-State Warrant Scraper — FBI + Federal Pruning Tests
// ============================================================
// Verifies:
//   1. The FBI Wanted API parser handles a representative
//      response shape (titles, classifications, missing fields).
//   2. pruneDeadFederalSources() disables perma-blocked sources
//      and redundant aliases without touching active sources.
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  pruneDeadFederalSources,
  _resetFederalPruningForTests,
  parseWithFallback,
} from '../multiStateWarrantScraper';

// Stub the database module so the migration runs against an in-memory DB.
// Must be hoisted via vi.mock so the import inside multiStateWarrantScraper
// resolves to our test instance.
let testDb: Database.Database;
vi.mock('../../models/database', () => ({
  getDb: () => testDb,
}));

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE warrant_scraper_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      source_url TEXT,
      source_type TEXT NOT NULL DEFAULT 'html',
      state TEXT NOT NULL DEFAULT 'UT',
      enabled INTEGER NOT NULL DEFAULT 0,
      scrape_interval_minutes INTEGER NOT NULL DEFAULT 120,
      consecutive_errors INTEGER NOT NULL DEFAULT 0,
      circuit_broken INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `).run();
  // Mirror the production scraped_warrants schema for the zombie-sweep
  // tests below (only the columns the sweep touches are required).
  db.prepare(`
    CREATE TABLE scraped_warrants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      cleared_at TEXT
    )
  `).run();
  return db;
}

function seedZombieWarrants(
  db: Database.Database,
  rows: { source_key: string; status?: string }[],
): void {
  const ins = db.prepare(
    `INSERT INTO scraped_warrants (source_key, first_name, last_name, status)
     VALUES (?, 'Zombie', 'Record', ?)`,
  );
  for (const r of rows) ins.run(r.source_key, r.status ?? 'active');
}

function countActive(db: Database.Database, source_key: string): number {
  return (db.prepare(
    "SELECT COUNT(*) as n FROM scraped_warrants WHERE source_key = ? AND status = 'active'",
  ).get(source_key) as { n: number }).n;
}

function countCleared(db: Database.Database, source_key: string): number {
  return (db.prepare(
    "SELECT COUNT(*) as n FROM scraped_warrants WHERE source_key = ? AND status = 'cleared'",
  ).get(source_key) as { n: number }).n;
}

function seedFederalSources(db: Database.Database, keys: { source_key: string; enabled: number }[]): void {
  const insert = db.prepare(
    `INSERT INTO warrant_scraper_config (source_key, display_name, source_url, source_type, state, enabled)
     VALUES (?, ?, '', 'html', 'US', ?)`,
  );
  for (const row of keys) insert.run(row.source_key, row.source_key, row.enabled);
}

function getEnabled(db: Database.Database, source_key: string): { enabled: number; last_error: string | null } {
  return db.prepare('SELECT enabled, last_error FROM warrant_scraper_config WHERE source_key = ?')
    .get(source_key) as { enabled: number; last_error: string | null };
}

describe('pruneDeadFederalSources', () => {
  beforeEach(() => {
    testDb = makeDb();
    _resetFederalPruningForTests();
  });

  it('disables perma-blocked Akamai-403 federal agencies', () => {
    seedFederalSources(testDb, [
      { source_key: 'fed_usms_wanted', enabled: 1 },
      { source_key: 'federal_usms_top15', enabled: 1 },
      { source_key: 'fed_atf_wanted', enabled: 1 },
      { source_key: 'fed_dea_wanted', enabled: 1 },
    ]);

    pruneDeadFederalSources();

    expect(getEnabled(testDb, 'fed_usms_wanted').enabled).toBe(0);
    expect(getEnabled(testDb, 'fed_usms_wanted').last_error).toContain('Akamai');
    expect(getEnabled(testDb, 'federal_usms_top15').enabled).toBe(0);
    expect(getEnabled(testDb, 'fed_atf_wanted').enabled).toBe(0);
    expect(getEnabled(testDb, 'fed_dea_wanted').enabled).toBe(0);
  });

  it('disables redundant alias source_keys but leaves canonical active', () => {
    seedFederalSources(testDb, [
      { source_key: 'fed_fbi_wanted', enabled: 1 },
      { source_key: 'federal_fbi_wanted', enabled: 1 },  // canonical
      { source_key: 'fed_ice_wanted', enabled: 1 },
      { source_key: 'federal_ice_wanted', enabled: 1 },  // canonical
    ]);

    pruneDeadFederalSources();

    expect(getEnabled(testDb, 'fed_fbi_wanted').enabled).toBe(0);
    expect(getEnabled(testDb, 'fed_fbi_wanted').last_error).toContain('Duplicate alias');
    expect(getEnabled(testDb, 'federal_fbi_wanted').enabled).toBe(1);
    expect(getEnabled(testDb, 'fed_ice_wanted').enabled).toBe(0);
    expect(getEnabled(testDb, 'federal_ice_wanted').enabled).toBe(1);
  });

  it('leaves unrelated active sources alone', () => {
    seedFederalSources(testDb, [
      { source_key: 'mt_flathead_warrants', enabled: 1 },
      { source_key: 'federal_fbi_wanted', enabled: 1 },
      { source_key: 'federal_postal_inspectors', enabled: 1 },
    ]);

    pruneDeadFederalSources();

    expect(getEnabled(testDb, 'mt_flathead_warrants').enabled).toBe(1);
    expect(getEnabled(testDb, 'federal_fbi_wanted').enabled).toBe(1);
    expect(getEnabled(testDb, 'federal_postal_inspectors').enabled).toBe(1);
  });

  it('is idempotent — second run is a no-op', () => {
    seedFederalSources(testDb, [{ source_key: 'fed_atf_wanted', enabled: 1 }]);
    pruneDeadFederalSources();
    expect(getEnabled(testDb, 'fed_atf_wanted').enabled).toBe(0);

    // Reset flag to force the SQL path again — should still not throw
    // and should leave the row at enabled=0 (the WHERE enabled=1 filter
    // makes the second pass a no-op).
    _resetFederalPruningForTests();
    expect(() => pruneDeadFederalSources()).not.toThrow();
    expect(getEnabled(testDb, 'fed_atf_wanted').enabled).toBe(0);
  });

  it('does not throw if the config table is missing', () => {
    testDb = new Database(':memory:');
    _resetFederalPruningForTests();
    expect(() => pruneDeadFederalSources()).not.toThrow();
  });

  it('sweeps active records from disabled sources to cleared', () => {
    seedFederalSources(testDb, [
      { source_key: 'fed_fbi_wanted', enabled: 1 },
      { source_key: 'federal_fbi_wanted', enabled: 1 },  // canonical, untouched
      { source_key: 'fed_atf_wanted', enabled: 1 },
    ]);
    seedZombieWarrants(testDb, [
      // Stale alias rows that should get swept
      { source_key: 'fed_fbi_wanted' },
      { source_key: 'fed_fbi_wanted' },
      { source_key: 'fed_atf_wanted' },
      // Canonical source — must NOT be swept
      { source_key: 'federal_fbi_wanted' },
      { source_key: 'federal_fbi_wanted' },
    ]);

    pruneDeadFederalSources();

    expect(countActive(testDb, 'fed_fbi_wanted')).toBe(0);
    expect(countCleared(testDb, 'fed_fbi_wanted')).toBe(2);
    expect(countActive(testDb, 'fed_atf_wanted')).toBe(0);
    expect(countCleared(testDb, 'fed_atf_wanted')).toBe(1);
    // Canonical source's records survive untouched.
    expect(countActive(testDb, 'federal_fbi_wanted')).toBe(2);
    expect(countCleared(testDb, 'federal_fbi_wanted')).toBe(0);
  });

  it('preserves pre-existing cleared_at timestamps when re-clearing', () => {
    seedFederalSources(testDb, [{ source_key: 'fed_fbi_wanted', enabled: 1 }]);
    // Already cleared with a known timestamp — sweep must not overwrite it.
    testDb.prepare(
      `INSERT INTO scraped_warrants (source_key, first_name, last_name, status, cleared_at)
       VALUES ('fed_fbi_wanted', 'Old', 'Record', 'cleared', '2024-01-01T00:00:00')`,
    ).run();

    pruneDeadFederalSources();

    const row = testDb.prepare(
      `SELECT cleared_at FROM scraped_warrants WHERE first_name = 'Old'`,
    ).get() as { cleared_at: string };
    expect(row.cleared_at).toBe('2024-01-01T00:00:00');
  });
});

describe('FBI Wanted API parser (via parseWithFallback)', () => {
  // Minimal config matching scrapeSource()'s expectations
  const fbiConfig = {
    id: 1,
    source_key: 'federal_fbi_wanted',
    display_name: 'FBI Most Wanted',
    source_url: 'https://api.fbi.gov/wanted/v1/list',
    source_type: 'api' as const,
    state: 'US',
    enabled: 1,
    scrape_interval_minutes: 120,
    consecutive_errors: 0,
    circuit_broken: 0,
  };

  it('parses a representative FBI API response into WarrantEntry[]', () => {
    const apiBody = JSON.stringify({
      total: 2,
      items: [
        {
          uid: 'abc123',
          title: 'JOHN MICHAEL DOE',
          dates_of_birth_used: ['January 15, 1980'],
          age_range: '40-45',
          sex: 'Male',
          race: 'White',
          person_classification: 'Main',
          poster_classification: 'ten',
          ncic: 'W-12345',
          publication: '2025-06-15T12:00:00',
          description: 'Wanted for armed robbery and homicide',
          caution: '<p>Considered armed and dangerous</p>',
          reward_text: '$100,000',
          images: [{ large: 'https://fbi.gov/img/large.jpg', thumb: 'https://fbi.gov/img/thumb.jpg' }],
          url: 'https://www.fbi.gov/wanted/example',
        },
        // Sparse record — many fields missing, parser must not throw.
        {
          uid: 'sparse',
          title: 'JANE SMITH',
        },
      ],
    });

    const result = parseWithFallback(fbiConfig as any, apiBody);

    expect(result.parserUsed).toBe('custom');
    expect(result.entries).toHaveLength(2);

    const [first, second] = result.entries;
    expect(first.warrant_id).toBe('abc123');
    expect(first.full_name).toBe('JOHN MICHAEL DOE');
    expect(first.first_name).toBe('JOHN');
    expect(first.last_name).toBe('DOE');
    expect(first.warrant_type).toBe('fugitive');  // person_classification === 'Main'
    expect(first.bail_amount).toBe('$100,000');
    expect(first.photo_url).toBe('https://fbi.gov/img/large.jpg');
    // The parser strips HTML from caution/description.
    expect(first.charge_description).not.toContain('<p>');

    expect(second.warrant_id).toBe('sparse');
    expect(second.full_name).toBe('JANE SMITH');
    // Missing fields default to safe empty values, not undefined.
    expect(second.bail_amount).toBe('');
    expect(second.photo_url).toBe('');
  });

  it('returns empty entries when API responds with empty list', () => {
    const apiBody = JSON.stringify({ total: 0, items: [] });
    const result = parseWithFallback(fbiConfig as any, apiBody);
    // Custom parser returned 0 → falls through to generic, which is also 0.
    expect(result.entries).toHaveLength(0);
  });

  it('falls back to generic when JSON is malformed', () => {
    const apiBody = '<html>not json</html>';
    const result = parseWithFallback(fbiConfig as any, apiBody);
    // Parser swallows JSON errors and returns []; generic kicks in but
    // also produces 0 from this body. The driftSignal flags the issue.
    expect(result.entries).toHaveLength(0);
    // parseWithFallback sets driftSignal when custom returns 0.
    expect(result.driftSignal).toBeDefined();
  });
});
