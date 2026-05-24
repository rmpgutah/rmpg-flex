-- ============================================================
-- Migration 0016 — DV + Pursuit supplements (NB-4)
-- ============================================================
-- 1:1 with incidents — UNIQUE(incident_id) enforces single DV
-- and single Pursuit supplement per incident.
-- ============================================================

CREATE TABLE IF NOT EXISTS dv_supplements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  relationship TEXT,
  prior_incidents_count INTEGER DEFAULT 0,
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
  primary_aggressor_person_id INTEGER REFERENCES persons(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dv_supplements_incident ON dv_supplements(incident_id);

CREATE TABLE IF NOT EXISTS pursuit_supplements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
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
  terminated_by_supervisor_id INTEGER REFERENCES users(id),
  collision_occurred INTEGER DEFAULT 0,
  collision_details TEXT,
  suspect_injuries TEXT,
  officer_injuries TEXT,
  bystander_injuries TEXT,
  property_damage_estimate REAL,
  supervisory_approval_user_id INTEGER REFERENCES users(id),
  supervisory_approval_at TEXT,
  review_completed INTEGER DEFAULT 0,
  review_findings TEXT,
  review_completed_by INTEGER REFERENCES users(id),
  review_completed_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pursuit_supplements_incident ON pursuit_supplements(incident_id);
