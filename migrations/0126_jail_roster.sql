-- migrations/0126_jail_roster.sql
-- Jail Roster scraper (ported from legacy VPS jailRosterScraper). Phase 1 ships
-- the framework + Salt Lake County (verified live 2026-06-15); other counties are
-- seeded disabled (no parser yet — Phase 2). Scraped bookings land in
-- arrest_records (read via /api/arrests); this schema is the scraper's own state.
-- ⚠️ Apply to live 785de7ae after merge (deploy migration step is continue-on-error);
-- the route also reconciles these at runtime via ensureJailRosterSchema().

CREATE TABLE IF NOT EXISTS jail_roster_config (
  county TEXT PRIMARY KEY,
  display_name TEXT,
  roster_url TEXT,
  roster_type TEXT,
  state TEXT DEFAULT 'UT',
  enabled INTEGER DEFAULT 0,
  scrape_interval_minutes INTEGER DEFAULT 60,
  last_scrape_at TEXT,
  last_sync TEXT,
  consecutive_errors INTEGER DEFAULT 0,
  circuit_broken INTEGER DEFAULT 0,
  is_scheduled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS jail_roster_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  county TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  status TEXT,
  records_found INTEGER DEFAULT 0,
  records_new INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jrsl_county ON jail_roster_sync_log(county, id DESC);

-- arrest_records is empty on live; this makes the scraper's ON CONFLICT upsert
-- safe + idempotent across re-scrapes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_arrest_jailbase_source ON arrest_records(jailbase_id, source_id);

-- Seed: Salt Lake County enabled (verified parser); Utah neighbors disabled
-- placeholders so the admin UI lists them for Phase 2 parser work.
INSERT OR IGNORE INTO jail_roster_config (county, display_name, roster_url, roster_type, state, enabled, scrape_interval_minutes) VALUES
  ('salt_lake', 'Salt Lake County Jail', 'https://iml.saltlakecounty.gov/IML', 'custom', 'UT', 1, 240),
  ('utah',      'Utah County Jail',      'https://sheriff.utahcounty.gov/api/search', 'custom', 'UT', 1, 240),
  ('davis',     'Davis County Jail',     'https://www.daviscountyutah.gov/sheriff/inmate-roster', 'custom', 'UT', 0, 240),
  ('weber',     'Weber County Jail',     'https://www.webercountyutah.gov/sheriff/roster', 'custom', 'UT', 0, 240),
  ('tooele',    'Tooele County Jail',    'https://inmate.tooelecountysheriff.org/roster', 'custom', 'UT', 0, 240);
