-- OSINT query cache: stores results from deepsearch, gofps, and gosearch
-- to avoid redundant external API calls. TTL-based expiry per source.
CREATE TABLE IF NOT EXISTS osint_cache (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT    NOT NULL,  -- 'deepsearch' | 'gofps' | 'gosearch'
  query_key     TEXT    NOT NULL,  -- normalized hash of query params
  query_text    TEXT    NOT NULL,  -- human-readable query for audit
  results_json  TEXT    NOT NULL,  -- JSON response payload
  user_id       INTEGER,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_osint_cache_source_key
  ON osint_cache(source, query_key);
CREATE INDEX IF NOT EXISTS idx_osint_cache_expires
  ON osint_cache(expires_at);
