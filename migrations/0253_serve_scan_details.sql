-- Rich device + hardware fingerprint captured from the subject's browser when
-- they scan a Notice of Attempt QR code.  Linked 1:1 to serve_qr_scans.id.
CREATE TABLE IF NOT EXISTS serve_scan_details (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id               INTEGER NOT NULL REFERENCES serve_qr_scans(id) ON DELETE CASCADE,
  hardware_concurrency  INTEGER,
  device_memory         REAL,
  battery_level         REAL,
  battery_charging      INTEGER,
  connection_downlink   REAL,
  connection_rtt        INTEGER,
  connection_save_data  INTEGER,
  screen_avail_w        INTEGER,
  screen_avail_h        INTEGER,
  screen_orientation    TEXT,
  color_gamut           TEXT,
  hdr_support           INTEGER,
  reduced_motion        INTEGER,
  pointer_type          TEXT,
  cookie_enabled        INTEGER,
  do_not_track          TEXT,
  canvas_fingerprint    TEXT,
  webgl_vendor          TEXT,
  webgl_renderer        TEXT,
  local_ips             TEXT,
  history_length        INTEGER,
  referrer              TEXT,
  pdf_support           INTEGER,
  time_on_page_ms       INTEGER,
  created_at            TEXT DEFAULT (datetime('now')),
  UNIQUE(scan_id)
);
CREATE INDEX IF NOT EXISTS idx_serve_scan_details_scan_id ON serve_scan_details(scan_id);
