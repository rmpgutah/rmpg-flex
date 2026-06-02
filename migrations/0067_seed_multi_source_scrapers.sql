-- Phase 1 multi-source warrant puller: register the two new scraper sources
-- so getEnabledAdapters() includes them, and index scraped_warrants for the
-- per-source upsert/clear lookups.
--
-- NOTE: warrant_scraper_config has NO UNIQUE constraint on source_name on live
-- D1 (verified 2026-06-02), so INSERT OR IGNORE would NOT dedupe on re-apply.
-- We use INSERT ... SELECT ... WHERE NOT EXISTS instead for true idempotency.
-- created_at has a DEFAULT (datetime('now','localtime')); source_type/priority
-- are nullable but supplied here.

INSERT INTO warrant_scraper_config (source_name, source_type, priority)
SELECT 'ada-county-id', 'html', 2
WHERE NOT EXISTS (
  SELECT 1 FROM warrant_scraper_config WHERE source_name = 'ada-county-id'
);

INSERT INTO warrant_scraper_config (source_name, source_type, priority)
SELECT 'natrona-county-wy', 'html', 2
WHERE NOT EXISTS (
  SELECT 1 FROM warrant_scraper_config WHERE source_name = 'natrona-county-wy'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scraped_warrants_src_wid
  ON scraped_warrants(source_key, warrant_id);
CREATE INDEX IF NOT EXISTS idx_scraped_warrants_src_status
  ON scraped_warrants(source_key, status);
