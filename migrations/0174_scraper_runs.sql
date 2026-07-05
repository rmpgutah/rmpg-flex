-- 0174: scraper_runs — per-source, per-attempt run history for the warrant
-- scraper ops surface. Backs real health_grade computation in
-- src/routes/scrapers.ts, replacing the always-null placeholder shipped in
-- PR #2593. One row per source per scan attempt (cron sweep or manual
-- admin trigger), distinguished by `trigger`.
CREATE TABLE IF NOT EXISTS scraper_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  success INTEGER NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  cleared INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  trigger TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scraper_runs_source_key ON scraper_runs(source_key, started_at);
