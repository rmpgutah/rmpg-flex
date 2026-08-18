-- Tracks Mapbox Optimization V2 async jobs.
-- V2 is async: POST returns a Mapbox UUID, GET polls for solution.
-- ref_id links serve_run jobs to their serve_routes row for write-back.
CREATE TABLE IF NOT EXISTS mapbox_optimization_v2_jobs (
  id            TEXT PRIMARY KEY,
  job_type      TEXT NOT NULL CHECK(job_type IN ('serve_run','patrol_beat','multi_unit_dispatch')),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','processing','complete','error')),
  problem_json  TEXT NOT NULL,
  solution_json TEXT,
  ref_id        INTEGER,
  created_by    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_opt_v2_jobs_type   ON mapbox_optimization_v2_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_opt_v2_jobs_user   ON mapbox_optimization_v2_jobs(created_by);
CREATE INDEX IF NOT EXISTS idx_opt_v2_jobs_status ON mapbox_optimization_v2_jobs(status);
