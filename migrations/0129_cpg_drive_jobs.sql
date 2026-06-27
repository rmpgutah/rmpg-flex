-- Full-drive job tracking: one job per user request; one trip per moving segment.
-- cpg_drive_jobs groups all trips for a single "Start Full Drive" click.
-- cpg_drive_job_trips links each detected trip to a footage_request for status.

CREATE TABLE IF NOT EXISTS cpg_drive_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  unit_id INTEGER,
  from_ts INTEGER NOT NULL,
  to_ts INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'detecting',  -- detecting | running | done | error
  trip_count INTEGER DEFAULT 0,
  clips_requested INTEGER DEFAULT 0,
  clips_ready INTEGER DEFAULT 0,
  error_msg TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cpg_drive_job_trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  trip_number INTEGER NOT NULL,
  label TEXT NOT NULL,             -- "Trip 1: 08:32 AM – 10:17 AM"
  from_ts INTEGER NOT NULL,        -- epoch ms
  to_ts INTEGER NOT NULL,          -- epoch ms
  footage_request_id INTEGER,      -- FK to footage_requests (null until enqueued)
  chunk_count INTEGER DEFAULT 0,
  chunks_done INTEGER DEFAULT 0,   -- downloaded
  chunks_missing INTEGER DEFAULT 0, -- no footage (engine off / gap)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | fulfilling | done | partial
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_drive_jobs_device ON cpg_drive_jobs(device_id);
CREATE INDEX IF NOT EXISTS idx_drive_job_trips_job ON cpg_drive_job_trips(job_id);
CREATE INDEX IF NOT EXISTS idx_drive_job_trips_req ON cpg_drive_job_trips(footage_request_id);
