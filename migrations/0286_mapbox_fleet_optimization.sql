-- Expand job types for fleet services and capacity-constrained pickup/delivery.
CREATE TABLE mapbox_optimization_v2_jobs_next (
  id            TEXT PRIMARY KEY,
  job_type      TEXT NOT NULL CHECK(job_type IN ('serve_run','patrol_beat','multi_unit_dispatch','fleet_route')),
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

INSERT INTO mapbox_optimization_v2_jobs_next SELECT * FROM mapbox_optimization_v2_jobs;
DROP TABLE mapbox_optimization_v2_jobs;
ALTER TABLE mapbox_optimization_v2_jobs_next RENAME TO mapbox_optimization_v2_jobs;
CREATE INDEX IF NOT EXISTS idx_opt_v2_jobs_type   ON mapbox_optimization_v2_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_opt_v2_jobs_user   ON mapbox_optimization_v2_jobs(created_by);
CREATE INDEX IF NOT EXISTS idx_opt_v2_jobs_status ON mapbox_optimization_v2_jobs(status);
