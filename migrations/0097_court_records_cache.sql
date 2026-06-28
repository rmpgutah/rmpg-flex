-- 0097: cache for open-source court-records lookups (CourtListener / RECAP).
-- The deep sweep queries CourtListener's public API by party name on a scan;
-- results are cached here (24h TTL enforced in code) to respect the API's
-- rate limits and keep repeat scans instant. (Applied to live D1 2026-06-11.)

CREATE TABLE IF NOT EXISTS court_records_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_key TEXT NOT NULL,
  last_name TEXT,
  first_name TEXT,
  source TEXT,
  results TEXT,
  result_count INTEGER DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_court_cache_key ON court_records_cache(query_key);
