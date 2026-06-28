-- 0152_serve_intake_judge.sql
-- Quality-Gate Phase 1: judge audit + per-row quality flag.

CREATE TABLE IF NOT EXISTS serve_intake_judge_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  model TEXT NOT NULL,
  ms INTEGER NOT NULL,
  raw_response TEXT,
  flagged_field_count INTEGER NOT NULL DEFAULT 0,
  overall_status TEXT NOT NULL,
  fallback_chain TEXT NOT NULL,
  upload_user_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_judge_runs_created
  ON serve_intake_judge_runs(created_at DESC);

ALTER TABLE serve_queue ADD COLUMN quality_status TEXT NOT NULL DEFAULT 'clean';
ALTER TABLE serve_queue ADD COLUMN judge_run_id INTEGER REFERENCES serve_intake_judge_runs(id);
ALTER TABLE serve_queue ADD COLUMN quality_reviewed_by INTEGER;
ALTER TABLE serve_queue ADD COLUMN quality_reviewed_at TEXT;
