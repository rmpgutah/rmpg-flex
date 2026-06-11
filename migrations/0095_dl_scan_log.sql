-- 0095: ID-scan audit log. Every DL/ID scan and its findings (alerts,
-- sweep hits, MVR status, person link) is a system record — officer-
-- safety requirement. Written by POST /api/dl-records/scan-log.
-- (Applied directly to live D1 2026-06-11 per the migration-drift SOP.)

CREATE TABLE IF NOT EXISTS dl_scan_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  scan_method TEXT,
  dl_number TEXT,
  dl_state TEXT,
  subject_name TEXT,
  dob TEXT,
  person_id INTEGER,
  findings TEXT
);

CREATE INDEX IF NOT EXISTS idx_dl_scan_log_subject ON dl_scan_log(dl_number, dl_state);
CREATE INDEX IF NOT EXISTS idx_dl_scan_log_person ON dl_scan_log(person_id);
