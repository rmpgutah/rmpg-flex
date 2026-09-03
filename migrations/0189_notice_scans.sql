-- 0189_notice_scans.sql
-- QR "Notice of Attempt to Serve" scan evidence, keyed to a serve job.
-- Written by the email/scan beacon Worker (rmpg-email-beacon) when a subject
-- opens a notice's QR link; surfaced in the Process Server module UI.
CREATE TABLE IF NOT EXISTS notice_scans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id   INTEGER NOT NULL,
  job_ref          TEXT,
  scanned_at       TEXT DEFAULT (datetime('now','localtime')),
  ip_address       TEXT,
  user_agent       TEXT,
  accept_language  TEXT,
  geo_city         TEXT,
  geo_region       TEXT,
  geo_country      TEXT,
  geo_lat          REAL,
  geo_lng          REAL,
  geo_postal       TEXT,
  device_type      TEXT,
  device_brand     TEXT,
  device_model     TEXT,
  os_family        TEXT,
  browser_family   TEXT,
  browser_version  TEXT,
  touch_capable    BOOLEAN,
  is_proxy         BOOLEAN,
  is_bot           BOOLEAN,
  raw              TEXT,
  FOREIGN KEY (serve_queue_id) REFERENCES serve_queue(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notice_scans_queue ON notice_scans(serve_queue_id, scanned_at);
CREATE INDEX IF NOT EXISTS idx_notice_scans_ref ON notice_scans(job_ref);