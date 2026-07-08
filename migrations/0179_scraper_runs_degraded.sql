-- 0179_scraper_runs_degraded.sql
-- Adds a `degraded` signal to scraper_runs so health grading can tell "this
-- source silently returned nothing after an error" apart from "this source
-- is genuinely quiet today." Also closes a real data-integrity gap: nothing
-- has ever enforced uniqueness on warrant_scraper_config.source_name (see
-- migrations/0067_seed_multi_source_scrapers.sql's own comment about this).

ALTER TABLE scraper_runs ADD COLUMN degraded INTEGER NOT NULL DEFAULT 0;

-- Dedupe any existing collisions first (keep the lowest rowid per name),
-- then enforce uniqueness going forward via a unique index — D1/SQLite can't
-- add a column-level UNIQUE constraint to an existing table via ALTER TABLE.
DELETE FROM warrant_scraper_config
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM warrant_scraper_config GROUP BY source_name
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_warrant_scraper_config_source_name
  ON warrant_scraper_config(source_name);
