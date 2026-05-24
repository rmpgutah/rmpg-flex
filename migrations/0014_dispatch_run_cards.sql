-- ============================================================
-- Migration 0014 — Dispatch Run Cards (Spillman parity, DI-1)
-- ============================================================
-- Canned dispatch templates: incident_type → unit count / roles /
-- auto-flags / priority. Applied on call creation when a matching
-- active card exists. Dispatcher can override every value after.
-- ============================================================

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

-- New columns on calls_for_service to record which run card was applied
ALTER TABLE calls_for_service ADD COLUMN run_card_id INTEGER;
ALTER TABLE calls_for_service ADD COLUMN run_card_applied_at TEXT;

-- ── 32-card seed ──
-- Spillman-flex typical dispatch protocols. INSERT OR IGNORE is
-- idempotent — re-running the migration is safe.
INSERT OR IGNORE INTO dispatch_run_cards
  (incident_type, display_name, default_priority, required_units, backup_units,
   required_roles, auto_flags, recommended_codes, officer_safety_alert,
   silent_response_default, ems_requested, fire_requested, notes) VALUES
('structure_fire',       'Structure Fire',                'P1', 2, 1, '["patrol","supervisor"]', '{"officer_safety_caution":1}', '["10-70","904"]', 1, 0, 1, 1, 'Auto-dispatch 2 patrol + supervisor; request EMS + fire.'),
('vehicle_fire',         'Vehicle Fire',                  'P2', 1, 1, '["patrol"]', '{}', '["904"]', 0, 0, 1, 1, 'EMS + fire requested.'),
('shots_fired',          'Shots Fired',                   'P1', 3, 2, '["patrol","supervisor"]', '{"weapons_involved":"firearm","officer_safety_caution":1,"felony_in_progress":1}', '["10-71"]', 1, 0, 1, 0, 'High-risk — multiple units, supervisor, stage EMS.'),
('shooting',             'Shooting / Active Shooter',     'P1', 4, 2, '["patrol","supervisor","k9"]', '{"weapons_involved":"firearm","officer_safety_caution":1,"felony_in_progress":1,"injuries_reported":1}', '["10-71","998"]', 1, 0, 1, 0, 'Multi-unit, K9, supervisor; stage EMS.'),
('stabbing',             'Stabbing / Knife Attack',       'P1', 2, 1, '["patrol","supervisor"]', '{"weapons_involved":"knife","officer_safety_caution":1,"injuries_reported":1}', '["10-72"]', 1, 0, 1, 0, 'Stage EMS; supervisor.'),
('robbery_in_progress',  'Robbery In Progress',           'P1', 3, 1, '["patrol","supervisor"]', '{"weapons_involved":"unknown","officer_safety_caution":1,"felony_in_progress":1}', '["211"]', 1, 1, 0, 0, 'Silent run, contain perimeter.'),
('burglary_in_progress', 'Burglary In Progress',          'P1', 2, 1, '["patrol","k9"]', '{"officer_safety_caution":1,"felony_in_progress":1}', '["10-31","459"]', 1, 1, 0, 0, 'Silent run; K9 staged.'),
('domestic_in_progress', 'Domestic In Progress',          'P1', 2, 0, '["patrol"]', '{"domestic_violence":1,"officer_safety_caution":1}', '["10-15","10-16"]', 1, 0, 1, 0, '2-officer rule; EMS staged.'),
('domestic_disturbance', 'Domestic Disturbance (Past)',   'P2', 2, 0, '["patrol"]', '{"domestic_violence":1}', '["10-15"]', 0, 0, 0, 0, '2-officer rule even on past-tense calls.'),
('mva_injury',           'MVA — Injury',                  'P2', 1, 0, '["patrol"]', '{"injuries_reported":1}', '["10-50"]', 0, 0, 1, 1, 'EMS + fire (extrication potential).'),
('mva_non_injury',       'MVA — Non-Injury',              'P3', 1, 0, '["patrol"]', '{}', '["10-51"]', 0, 0, 0, 0, 'Single unit; document only.'),
('hit_and_run',          'Hit and Run',                   'P2', 1, 0, '["patrol"]', '{}', '["10-57"]', 0, 0, 0, 0, 'BOLO suspect vehicle.'),
('dui_driver',           'Intoxicated / DUI Driver',      'P2', 1, 1, '["patrol"]', '{"alcohol_involved":1}', '["10-55","502"]', 0, 0, 0, 0, 'Backup for transport / SFST.'),
('traffic_stop',         'Traffic Stop (Officer Initiated)', 'P3', 1, 0, '["patrol"]', '{}', '["10-38"]', 0, 0, 0, 0, 'Officer-initiated; backup on request.'),
('felony_traffic_stop',  'Felony Traffic Stop',           'P1', 2, 2, '["patrol","supervisor"]', '{"officer_safety_caution":1,"felony_in_progress":1,"weapons_involved":"unknown"}', '["10-38","10-32"]', 1, 0, 0, 0, 'High-risk stop protocol.'),
('vehicle_pursuit',      'Vehicle Pursuit',               'P1', 3, 1, '["patrol","supervisor","k9"]', '{"vehicle_pursuit":1,"officer_safety_caution":1}', '["10-80"]', 1, 0, 0, 0, 'Supervisor must monitor; lead + secondary + spike strip unit.'),
('foot_pursuit',         'Foot Pursuit',                  'P1', 2, 2, '["patrol","k9"]', '{"foot_pursuit":1,"officer_safety_caution":1}', '["10-80"]', 1, 0, 0, 0, 'Containment + K9.'),
('panic_alarm',          'Panic / Hold-Up Alarm',         'P1', 2, 1, '["patrol"]', '{"officer_safety_caution":1}', '["10-90"]', 1, 1, 0, 0, 'Silent approach mandatory.'),
('residential_alarm',    'Residential Burglar Alarm',     'P3', 1, 1, '["patrol"]', '{}', '[]', 0, 0, 0, 0, 'Single unit; backup auto-suggested.'),
('commercial_alarm',     'Commercial Burglar Alarm',      'P3', 1, 1, '["patrol"]', '{}', '[]', 0, 0, 0, 0, 'Single unit; backup auto-suggested.'),
('fire_alarm',           'Fire Alarm',                    'P2', 1, 0, '["patrol"]', '{}', '["10-70"]', 0, 0, 0, 1, 'Fire dispatched; patrol secures scene.'),
('medical_emergency',    'Medical Emergency',             'P2', 1, 0, '["patrol"]', '{"injuries_reported":1}', '["10-52","901"]', 0, 0, 1, 1, 'Patrol stages until EMS clears.'),
('mental_subject',       'Mental Health Crisis',          'P2', 2, 0, '["patrol"]', '{"mental_health_crisis":1}', '["10-96"]', 0, 0, 1, 0, '2-officer; CIT-trained if available; EMS staged.'),
('suicidal_subject',     'Suicidal Subject',              'P1', 2, 1, '["patrol","supervisor"]', '{"mental_health_crisis":1,"officer_safety_caution":1}', '["10-96"]', 1, 0, 1, 0, 'Supervisor + CIT; EMS staged.'),
('officer_assist',       'Officer Needs Assistance',      'P1', 3, 2, '["patrol","supervisor"]', '{"officer_safety_caution":1}', '["10-78","10-00"]', 1, 0, 1, 0, 'All available units; supervisor; stage EMS.'),
('officer_down',         'Officer Down',                  'P1', 5, 3, '["patrol","supervisor","k9"]', '{"officer_safety_caution":1,"injuries_reported":1}', '["10-0","999"]', 1, 0, 1, 1, 'ALL units; supervisor; EMS + fire emergency.'),
('bomb_threat',          'Bomb Threat',                   'P1', 2, 2, '["patrol","supervisor"]', '{"officer_safety_caution":1,"hazmat":1}', '["10-89"]', 1, 1, 1, 1, 'Silent approach (no RF); EOD; evacuate.'),
('hazmat',               'HAZMAT Incident',               'P1', 1, 1, '["patrol","supervisor"]', '{"hazmat":1}', '[]', 1, 0, 1, 1, 'Stage upwind; fire HAZMAT team primary.'),
('trespass',             'Trespass Complaint',            'P3', 1, 0, '["patrol"]', '{}', '[]', 0, 0, 0, 0, 'Single unit; check trespass orders on file.'),
('suspicious_person',    'Suspicious Person',             'P3', 1, 0, '["patrol"]', '{}', '["925"]', 0, 0, 0, 0, 'Single unit; FI card on contact.'),
('welfare_check',        'Welfare Check',                 'P3', 1, 0, '["patrol"]', '{}', '[]', 0, 0, 0, 0, 'Single unit; EMS on request.'),
('disturbance',          'General Disturbance / Noise',   'P3', 1, 0, '["patrol"]', '{}', '["415"]', 0, 0, 0, 0, 'Single unit.');
