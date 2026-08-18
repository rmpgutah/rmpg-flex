-- enrichment_cache: 24-hour cache of open-source enrichment results
-- keyed by SHA-256(normalize(first_name + last_name + dob))
CREATE TABLE IF NOT EXISTS enrichment_cache (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key    TEXT NOT NULL UNIQUE,
  seed_json    TEXT NOT NULL,
  results_json TEXT NOT NULL,
  match_tier   TEXT NOT NULL DEFAULT 'UNCONFIRMED',
  anchors_json TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  searched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  searched_by  INTEGER,
  org_id       TEXT
);
CREATE INDEX IF NOT EXISTS idx_enrichment_cache_key     ON enrichment_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_enrichment_cache_expires ON enrichment_cache(expires_at);
