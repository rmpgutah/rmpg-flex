CREATE TABLE IF NOT EXISTS job_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type     TEXT NOT NULL,
  -- 'footage_backfill' | 'alpr_confidence' | 'analytics_replay'
  status       TEXT NOT NULL DEFAULT 'running',
  -- 'running' | 'complete' | 'failed'
  total        INTEGER DEFAULT 0,
  processed    INTEGER DEFAULT 0,
  skipped      INTEGER DEFAULT 0,
  errors       INTEGER DEFAULT 0,
  error_detail TEXT,
  skipped_detail TEXT,  -- JSON array of skipped unit/trip details (footage backfill)
  started_by   INTEGER,   -- user_id
  started_at   TEXT DEFAULT (datetime('now')),
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_runs_type ON job_runs(job_type, id DESC);
