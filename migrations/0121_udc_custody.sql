-- 0121_udc_custody.sql
-- Per-person Utah DOC custody snapshots. The UDC public API
-- (api.utah.gov/udc/v1/public/rest/offenders) has no bulk-list endpoint,
-- so rows are snapshotted as persons are looked up / watched.
-- detail_json preserves the complete api.utah.gov detail response verbatim
-- (capture-all-data) so any future field survives without a schema change.
CREATE TABLE IF NOT EXISTS udc_custody (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offender_number INTEGER UNIQUE NOT NULL,
  offender_name TEXT,
  date_of_birth TEXT,
  location TEXT,
  housing_facility TEXT,
  release_date_and_type TEXT,
  case_manager_name TEXT,
  case_manager_email TEXT,
  detail_json TEXT,
  person_id INTEGER,
  source TEXT DEFAULT 'UDC_API',
  last_seen_at TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_udc_custody_person ON udc_custody(person_id);
