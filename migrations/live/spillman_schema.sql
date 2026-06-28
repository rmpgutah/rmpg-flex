-- ============================================================
-- Spillman Flex deltas — live D1 (rmpg-flex-db) schema additions
-- ============================================================
-- This file consolidates my migrations 0014-0018 into a single
-- live-compatible form. Skips the legacy `wrangler migrations apply`
-- machinery (which would also try to run unrelated 0004-0013 files
-- from the legacy server side) by being applied directly via
-- `wrangler d1 execute rmpg-flex-db --remote --file=migrations/live/spillman_schema.sql`
--
-- Adjustments vs the original numbered migrations:
--   - 0017 (incident_links CHECK rebuild) is rewritten to match the
--     lean API's incident_links shape: 6-value CHECK + no link_reason
--     or added_by columns.
--   - calls_for_service.run_card_id / run_card_applied_at use ALTER
--     TABLE ADD COLUMN (live calls_for_service has all my expected
--     columns except these two).
-- ============================================================

-- ── DI-1: Run cards ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_run_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_type TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  default_priority TEXT NOT NULL DEFAULT 'P3',
  required_units INTEGER NOT NULL DEFAULT 1,
  backup_units INTEGER NOT NULL DEFAULT 0,
  required_roles TEXT NOT NULL DEFAULT '[]',
  auto_flags TEXT NOT NULL DEFAULT '{}',
  recommended_codes TEXT NOT NULL DEFAULT '[]',
  officer_safety_alert INTEGER NOT NULL DEFAULT 0,
  silent_response_default INTEGER NOT NULL DEFAULT 0,
  ems_requested INTEGER NOT NULL DEFAULT 0,
  fire_requested INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_run_cards_active ON dispatch_run_cards(active, incident_type);

-- ── DI-5: Per-unit audio mode ─────────────────────────────
-- units already exists; just add the column.
ALTER TABLE units ADD COLUMN audio_mode TEXT DEFAULT 'audible';

-- ── DI-1 / DI-5 bridge: track which run card was applied ──
ALTER TABLE calls_for_service ADD COLUMN run_card_id INTEGER;
ALTER TABLE calls_for_service ADD COLUMN run_card_applied_at TEXT;

-- ── NB-1: NIBRS code tables ───────────────────────────────
CREATE TABLE IF NOT EXISTS nibrs_offense_codes (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  ucr_group TEXT NOT NULL DEFAULT 'A',
  category TEXT NOT NULL,
  attempted_completed_required INTEGER NOT NULL DEFAULT 0,
  victim_required INTEGER NOT NULL DEFAULT 0,
  weapon_required INTEGER NOT NULL DEFAULT 0,
  bias_required INTEGER NOT NULL DEFAULT 0,
  property_required INTEGER NOT NULL DEFAULT 0,
  drug_required INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_nibrs_offense_group ON nibrs_offense_codes(ucr_group, active);

CREATE TABLE IF NOT EXISTS nibrs_location_codes (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nibrs_weapon_codes   (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nibrs_bias_codes     (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nibrs_property_descriptions (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nibrs_property_loss_types   (code TEXT PRIMARY KEY, description TEXT NOT NULL);

-- ── NB-4: DV + Pursuit supplements ────────────────────────
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

-- ── NB-5: FI cross-link in incident_links ─────────────────
-- Live schema: linked_type CHECK IN ('call','case','warrant','citation','arrest','bolo')
-- and the table has only (id, incident_id, linked_type, linked_id, created_at) — no
-- link_reason or added_by like the legacy server. Rebuild preserves the lean shape
-- and adds 'field_interview' + 'incident' (the latter the legacy assumed) to CHECK.
CREATE TABLE IF NOT EXISTS incident_links_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  linked_type TEXT NOT NULL CHECK(linked_type IN ('call','case','warrant','citation','arrest','bolo','incident','field_interview')),
  linked_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

INSERT INTO incident_links_new (id, incident_id, linked_type, linked_id, created_at)
SELECT id, incident_id, linked_type, linked_id, created_at FROM incident_links;

DROP TABLE incident_links;
ALTER TABLE incident_links_new RENAME TO incident_links;
