-- Tracks every scan of a Notice of Attempt QR code.
-- Written by the public /api/verify route; officer is notified on insert.
CREATE TABLE IF NOT EXISTS serve_qr_scans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_ref     TEXT    NOT NULL,           -- e.g. "JOB-122" or court case number
  job_id      INTEGER REFERENCES serve_queue(id),
  scanned_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  ip_address  TEXT,
  user_agent  TEXT,
  notified    INTEGER NOT NULL DEFAULT 0  -- 1 once the officer WS push was sent
);

CREATE INDEX IF NOT EXISTS idx_serve_qr_scans_job_ref ON serve_qr_scans(job_ref);
CREATE INDEX IF NOT EXISTS idx_serve_qr_scans_job_id  ON serve_qr_scans(job_id);
