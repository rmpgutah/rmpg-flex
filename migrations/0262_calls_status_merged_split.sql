-- 0262_calls_status_merged_split.sql
-- =====================================================================
-- Add 'merged' and 'split' to the calls_for_service.status CHECK enum.
--
-- The merge handler (src/routes/dispatch/calls.ts, UPDATE ... status='merged')
-- and the split handler write these two statuses; with the 0040 CHECK they
-- hit a constraint violation and 500 on every call merge / split.
--
-- WHY A FULL TABLE REBUILD:
--   SQLite (and therefore D1) cannot ALTER an existing CHECK constraint. The
--   only way is the standard create-new -> copy -> drop -> rename procedure,
--   exactly as 0040_calls_status_add_on_hold.sql did.
--
-- HISTORY / WHY THIS FILE WAS REWRITTEN:
--   The first revision of 0262 declared a 38-column calls_for_service_new with
--   the WRONG column names (call_type / location / assigned_unit ...) and then
--   DROP TABLE'd the real 100-column table. Under wrangler's per-file
--   transaction the copy failed ("no such column: call_type") and the file
--   rolled back, so it never applied anywhere — but executed statement by
--   statement (local bootstrap, manual d1 execute) it silently replaced the CFS
--   table with an empty 38-column shell and every dispatch read 500'd with
--   "no such column: c.incident_type". tests/migration0262CallsRebuild.test.ts
--   now pins this file's column list to migrations/baseline/schema.sql.
--
-- ⚠️  100-COLUMN HARD CAP (verified 2026-09-05 against workerd's SQLite):
--   D1's SQLite is compiled with SQLITE_MAX_COLUMN = 100. A calls_for_service
--   with 101 columns is not "slow" — SQLite reports
--   "malformed database schema (calls_for_service) - too many columns" and
--   the WHOLE table becomes SQLITE_CORRUPT / unreadable. The table is at
--   exactly 100. This rebuild therefore copies exactly the 100 live columns
--   and refuses to run (transaction aborts on the _guard CHECK) if the live
--   column count is anything other than 100 — e.g. if someone lands an
--   ALTER ... ADD COLUMN first. Never add a column to this table; use
--   calls_for_service_ext (see CLAUDE.md gotcha #19).
--
-- ⚠️  RISK / TEST-FIRST (same as 0040):
--   calls_for_service is referenced by FOREIGN KEYs from several tables and
--   FK enforcement is ON on live D1; PRAGMA foreign_keys is a no-op inside a
--   transaction, so verify against a copy first. After applying:
--     SELECT sql FROM sqlite_master WHERE name='calls_for_service'; -- has 'merged','split'
--     SELECT COUNT(*) FROM calls_for_service;                        -- row count preserved
--     SELECT COUNT(*) FROM pragma_table_info('calls_for_service');   -- 100
-- =====================================================================

PRAGMA foreign_keys=OFF;

-- Precondition guard: abort the whole file unless calls_for_service has
-- exactly the 100 columns enumerated below. abs(-9223372036854775808) raises
-- "integer overflow", so this single side-effect-free SELECT errors out (and
-- wrangler's per-file transaction rolls back) before anything is touched.
-- Deliberately one statement with no writes, so it is also safe when a file is
-- replayed statement-by-statement outside a transaction.
SELECT CASE
  WHEN (SELECT COUNT(*) FROM pragma_table_info('calls_for_service')) <> 100
  THEN abs(-9223372036854775808)
END AS calls_for_service_must_have_exactly_100_columns;

CREATE TABLE calls_for_service_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_number TEXT UNIQUE,
  incident_type TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('P1','P2','P3','P4')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispatched','enroute','onscene','cleared','closed','cancelled','archived','on_hold','merged','split')),
  caller_name TEXT,
  caller_phone TEXT,
  caller_relationship TEXT,
  location_address TEXT NOT NULL,
  property_id INTEGER,
  latitude REAL,
  longitude REAL,
  description TEXT,
  notes TEXT,
  source TEXT DEFAULT 'phone' CHECK(source IN ('phone','radio','alarm','walk_in','email','patrol','online','dispatch','panic','servemanager','intake','other')),
  assigned_unit_ids TEXT DEFAULT '[]',
  dispatcher_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  dispatched_at TEXT,
  enroute_at TEXT,
  onscene_at TEXT,
  cleared_at TEXT,
  closed_at TEXT,
  disposition TEXT,
  supervisor_notified INTEGER DEFAULT 0,
  le_notified INTEGER DEFAULT 0,
  le_agency TEXT,
  le_case_number TEXT,
  damage_estimate REAL,
  damage_description TEXT,
  action_taken TEXT,
  updated_at TEXT,
  received_at TEXT,
  previous_status TEXT,
  client_id INTEGER,
  reporting_officer_id INTEGER,
  priority_score INTEGER DEFAULT 0,
  weapons_involved TEXT DEFAULT NULL,
  domestic_violence INTEGER DEFAULT 0,
  injuries_reported INTEGER DEFAULT 0,
  alcohol_involved INTEGER DEFAULT 0,
  drugs_involved INTEGER DEFAULT 0,
  archived_at TEXT,
  status_changed_at TEXT,
  caller_address TEXT,
  zone_beat TEXT,
  sector_id TEXT,
  zone_id TEXT,
  beat_id TEXT,
  cross_street TEXT,
  location_building TEXT,
  location_floor TEXT,
  location_room TEXT,
  num_subjects INTEGER,
  subject_description TEXT,
  vehicle_description TEXT,
  direction_of_travel TEXT,
  responding_officer TEXT,
  secondary_type TEXT,
  contact_method TEXT,
  scene_safety TEXT,
  weather_conditions TEXT,
  lighting_conditions TEXT,
  num_victims INTEGER,
  starting_mileage REAL,
  ending_mileage REAL,
  case_id INTEGER,
  case_number TEXT,
  dispatch_code TEXT,
  section_name TEXT,
  sector_name TEXT,
  zone_name TEXT,
  beat_name TEXT,
  beat_descriptor TEXT,
  contract_id TEXT,
  response_time_seconds REAL,
  onscene_duration_seconds REAL,
  overdue_notified TEXT,
  pso_requestor_name TEXT,
  pso_requestor_phone TEXT,
  pso_requestor_email TEXT,
  pso_service_type TEXT,
  pso_billing_code TEXT,
  pso_authorization TEXT,
  pso_attempt_number INTEGER,
  pso_service_windows TEXT,
  process_service_type TEXT,
  process_served_to TEXT,
  process_served_address TEXT,
  process_attempts INTEGER,
  process_served_at TEXT,
  process_service_result TEXT,
  unit_call_signs TEXT,
  responding_vehicle_id INTEGER,
  mental_health_crisis INTEGER DEFAULT 0,
  juvenile_involved INTEGER DEFAULT 0,
  felony_in_progress INTEGER DEFAULT 0,
  officer_safety_caution INTEGER DEFAULT 0,
  k9_requested INTEGER DEFAULT 0,
  ems_requested INTEGER DEFAULT 0,
  FOREIGN KEY (dispatcher_id) REFERENCES users(id)
);

INSERT INTO calls_for_service_new (
  id, call_number, incident_type, priority, status, caller_name,
  caller_phone, caller_relationship, location_address, property_id, latitude, longitude,
  description, notes, source, assigned_unit_ids, dispatcher_id, created_at,
  dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, disposition,
  supervisor_notified, le_notified, le_agency, le_case_number, damage_estimate, damage_description,
  action_taken, updated_at, received_at, previous_status, client_id, reporting_officer_id,
  priority_score, weapons_involved, domestic_violence, injuries_reported, alcohol_involved, drugs_involved,
  archived_at, status_changed_at, caller_address, zone_beat, sector_id, zone_id,
  beat_id, cross_street, location_building, location_floor, location_room, num_subjects,
  subject_description, vehicle_description, direction_of_travel, responding_officer, secondary_type, contact_method,
  scene_safety, weather_conditions, lighting_conditions, num_victims, starting_mileage, ending_mileage,
  case_id, case_number, dispatch_code, section_name, sector_name, zone_name,
  beat_name, beat_descriptor, contract_id, response_time_seconds, onscene_duration_seconds, overdue_notified,
  pso_requestor_name, pso_requestor_phone, pso_requestor_email, pso_service_type, pso_billing_code, pso_authorization,
  pso_attempt_number, pso_service_windows, process_service_type, process_served_to, process_served_address, process_attempts,
  process_served_at, process_service_result, unit_call_signs, responding_vehicle_id, mental_health_crisis, juvenile_involved,
  felony_in_progress, officer_safety_caution, k9_requested, ems_requested
)
SELECT
  id, call_number, incident_type, priority, status, caller_name,
  caller_phone, caller_relationship, location_address, property_id, latitude, longitude,
  description, notes, source, assigned_unit_ids, dispatcher_id, created_at,
  dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, disposition,
  supervisor_notified, le_notified, le_agency, le_case_number, damage_estimate, damage_description,
  action_taken, updated_at, received_at, previous_status, client_id, reporting_officer_id,
  priority_score, weapons_involved, domestic_violence, injuries_reported, alcohol_involved, drugs_involved,
  archived_at, status_changed_at, caller_address, zone_beat, sector_id, zone_id,
  beat_id, cross_street, location_building, location_floor, location_room, num_subjects,
  subject_description, vehicle_description, direction_of_travel, responding_officer, secondary_type, contact_method,
  scene_safety, weather_conditions, lighting_conditions, num_victims, starting_mileage, ending_mileage,
  case_id, case_number, dispatch_code, section_name, sector_name, zone_name,
  beat_name, beat_descriptor, contract_id, response_time_seconds, onscene_duration_seconds, overdue_notified,
  pso_requestor_name, pso_requestor_phone, pso_requestor_email, pso_service_type, pso_billing_code, pso_authorization,
  pso_attempt_number, pso_service_windows, process_service_type, process_served_to, process_served_address, process_attempts,
  process_served_at, process_service_result, unit_call_signs, responding_vehicle_id, mental_health_crisis, juvenile_involved,
  felony_in_progress, officer_safety_caution, k9_requested, ems_requested
FROM calls_for_service;

DROP TABLE calls_for_service;

ALTER TABLE calls_for_service_new RENAME TO calls_for_service;

-- Recreate the non-autoindex indexes (UNIQUE on call_number is recreated
-- automatically by the column definition above).
CREATE INDEX IF NOT EXISTS idx_calls_lat_lng_created ON calls_for_service(latitude, longitude, created_at);
CREATE INDEX IF NOT EXISTS idx_cfs_status ON calls_for_service(status);
CREATE INDEX IF NOT EXISTS idx_cfs_priority ON calls_for_service(priority);
CREATE INDEX IF NOT EXISTS idx_cfs_zone ON calls_for_service(zone_id);
CREATE INDEX IF NOT EXISTS idx_cfs_beat ON calls_for_service(beat_id);
CREATE INDEX IF NOT EXISTS idx_cfs_case ON calls_for_service(case_id);
CREATE INDEX IF NOT EXISTS idx_cfs_client ON calls_for_service(client_id);

PRAGMA foreign_keys=ON;

-- Ensure run_card tracking columns exist on the ext table (0014 left these
-- commented out; baseline/schema.sql has them but numbered-migration builds
-- may not). D1 has no ADD COLUMN IF NOT EXISTS: on a DB that already has them
-- these two statements fail with "duplicate column name", which the
-- continue-on-error deploy step and scripts/apply-migration.sh both tolerate.
ALTER TABLE calls_for_service_ext ADD COLUMN run_card_id INTEGER;
ALTER TABLE calls_for_service_ext ADD COLUMN run_card_applied_at TEXT;
