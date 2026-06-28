-- 0040_calls_status_add_on_hold.sql
-- =====================================================================
-- Add 'on_hold' to the calls_for_service.status CHECK enum.
--
-- WHY A FULL TABLE REBUILD:
--   SQLite (and therefore D1) cannot ALTER an existing CHECK constraint.
--   The only way to change it is the standard create-new → copy → drop →
--   rename procedure.
--
-- ⚠️  RISK / TEST-FIRST:
--   calls_for_service is a 100-column table referenced by FOREIGN KEYs from
--   8 tables (units, incidents, call_persons, call_vehicles,
--   calls_for_service_ext, radio_transmissions, call_businesses, case_calls)
--   and FK enforcement is ON on live D1. We disable FK enforcement around the
--   swap. D1 may run a migration file inside an implicit transaction, in which
--   case PRAGMA foreign_keys is a no-op — so you MUST verify behaviour with
--   `npm run migrate:local` against a copy that has the same FK children before
--   applying to prod. After applying, confirm:
--     SELECT sql FROM sqlite_master WHERE name='calls_for_service';   -- has on_hold
--     SELECT COUNT(*) FROM calls_for_service;                          -- row count preserved
--
-- This migration ONLY changes the status CHECK line. Every other column,
-- default, constraint, and the dispatcher_id FK are reproduced verbatim from
-- the live schema (captured 2026-05-29) so `INSERT ... SELECT *` lines up 1:1.
-- =====================================================================

PRAGMA foreign_keys=OFF;

CREATE TABLE calls_for_service_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_number TEXT UNIQUE,
  incident_type TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('P1','P2','P3','P4')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispatched','enroute','onscene','cleared','closed','cancelled','archived','on_hold')),
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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
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

INSERT INTO calls_for_service_new SELECT * FROM calls_for_service;

DROP TABLE calls_for_service;

ALTER TABLE calls_for_service_new RENAME TO calls_for_service;

-- Recreate the non-autoindex indexes (UNIQUE on call_number is recreated
-- automatically by the column definition above).
CREATE INDEX idx_calls_lat_lng_created ON calls_for_service(latitude, longitude, created_at);
CREATE INDEX idx_cfs_status ON calls_for_service(status);
CREATE INDEX idx_cfs_priority ON calls_for_service(priority);
CREATE INDEX idx_cfs_zone ON calls_for_service(zone_id);
CREATE INDEX idx_cfs_beat ON calls_for_service(beat_id);
CREATE INDEX idx_cfs_case ON calls_for_service(case_id);
CREATE INDEX idx_cfs_client ON calls_for_service(client_id);

PRAGMA foreign_keys=ON;
