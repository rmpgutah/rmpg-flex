-- Tables that code referenced but were never created via migration.
-- Applied directly to live D1 (785de7ae) on 2026-06-07; this file
-- ensures local dev and future deploys stay in sync.

CREATE TABLE IF NOT EXISTS client_person_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  relationship TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (person_id) REFERENCES persons(id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS fi_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fi_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (fi_id) REFERENCES field_interviews(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles_records(id)
);

CREATE TABLE IF NOT EXISTS fleet_recurring_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  cost_type TEXT,
  description TEXT,
  cost REAL DEFAULT 0,
  date TEXT,
  frequency TEXT DEFAULT 'monthly',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  email_enabled INTEGER DEFAULT 1,
  push_enabled INTEGER DEFAULT 1,
  sms_enabled INTEGER DEFAULT 0,
  quiet_start TEXT,
  quiet_end TEXT,
  preferences TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- persons.fi_count / last_fi_date — field interview counters referenced
-- by fieldInterviews.ts but never migrated. Applied to live 2026-06-07.
-- D1 does not support IF NOT EXISTS on ADD COLUMN; this will fail on
-- re-apply (continue-on-error in deploy.yml handles it).
ALTER TABLE persons ADD COLUMN fi_count INTEGER DEFAULT 0;
ALTER TABLE persons ADD COLUMN last_fi_date TEXT;

-- Incident supplement tables referenced by incidentSupplements.ts.
-- Applied directly to live D1 (785de7ae) on 2026-06-07.

CREATE TABLE IF NOT EXISTS dv_supplements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL UNIQUE,
  relationship TEXT,
  prior_incidents_count INTEGER,
  prior_incidents_notes TEXT,
  children_present INTEGER DEFAULT 0,
  children_witnessed INTEGER DEFAULT 0,
  weapons_in_home INTEGER DEFAULT 0,
  weapons_in_home_notes TEXT,
  strangulation_alleged INTEGER DEFAULT 0,
  substance_abuse_alleged INTEGER DEFAULT 0,
  threats_to_kill INTEGER DEFAULT 0,
  threats_of_suicide INTEGER DEFAULT 0,
  lethality_score INTEGER,
  lethality_questions TEXT,
  lethality_high_danger INTEGER DEFAULT 0,
  mandatory_arrest_triggered INTEGER DEFAULT 0,
  victim_safety_plan_text TEXT,
  victim_shelter_referred INTEGER DEFAULT 0,
  victim_shelter_name TEXT,
  protective_order_issued INTEGER DEFAULT 0,
  protective_order_number TEXT,
  primary_aggressor_person_id INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
);

CREATE TABLE IF NOT EXISTS pursuit_supplements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL UNIQUE,
  pursuit_type TEXT,
  reason TEXT,
  statute_basis TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_seconds INTEGER,
  distance_miles REAL,
  max_speed_mph INTEGER,
  weather_conditions TEXT,
  road_conditions TEXT,
  traffic_density TEXT,
  time_of_day TEXT,
  jurisdictions TEXT,
  agencies_assisting TEXT,
  spike_strips_deployed INTEGER DEFAULT 0,
  spike_strips_effective INTEGER DEFAULT 0,
  pit_maneuver_attempted INTEGER DEFAULT 0,
  pit_maneuver_successful INTEGER DEFAULT 0,
  outcome TEXT,
  terminated_reason TEXT,
  terminated_by_supervisor_id INTEGER,
  collision_occurred INTEGER DEFAULT 0,
  collision_details TEXT,
  suspect_injuries TEXT,
  officer_injuries TEXT,
  bystander_injuries TEXT,
  property_damage_estimate REAL,
  supervisory_approval_user_id INTEGER,
  supervisory_approval_at TEXT,
  review_completed INTEGER DEFAULT 0,
  review_findings TEXT,
  review_completed_by INTEGER,
  review_completed_at TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
);
