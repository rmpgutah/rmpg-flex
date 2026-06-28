-- Migration number: 0011    2026-05-23T01:30:00.000Z
-- Add missing tables and columns for production D1 parity
-- call_visit_history, premise_alerts, geography alias columns, PSO columns

-- ── call_visit_history — referenced by dispatch call detail for PSO calls ──
CREATE TABLE IF NOT EXISTS call_visit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  visit_number INTEGER NOT NULL DEFAULT 1,
  status TEXT DEFAULT 'pending',
  officer_id INTEGER,
  scheduled_at TEXT,
  arrived_at TEXT,
  completed_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (call_id) REFERENCES calls_for_service(id) ON DELETE CASCADE,
  FOREIGN KEY (officer_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_call_visit_call ON call_visit_history(call_id);

-- ── premise_alerts — location-based warnings for dispatch ──
CREATE TABLE IF NOT EXISTS premise_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  alert_type TEXT NOT NULL DEFAULT 'caution',
  alert_level TEXT DEFAULT 'info',
  title TEXT NOT NULL,
  description TEXT,
  flags TEXT DEFAULT '[]',
  expires_at TEXT,
  created_by INTEGER,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_premise_alerts_address ON premise_alerts(address);
CREATE INDEX IF NOT EXISTS idx_premise_alerts_coords ON premise_alerts(latitude, longitude);

-- ── Geography alias columns — existing tables use `name` but Worker queries expect `sector_name` etc. ──
ALTER TABLE dispatch_sectors ADD COLUMN supervisor TEXT;
ALTER TABLE dispatch_sectors ADD COLUMN radio_channel TEXT;
ALTER TABLE dispatch_sectors ADD COLUMN active INTEGER DEFAULT 1;
ALTER TABLE dispatch_sectors ADD COLUMN updated_at TEXT DEFAULT (datetime('now','localtime'));

ALTER TABLE dispatch_zones ADD COLUMN zone_type TEXT;
ALTER TABLE dispatch_zones ADD COLUMN primary_unit TEXT;
ALTER TABLE dispatch_zones ADD COLUMN backup_unit TEXT;
ALTER TABLE dispatch_zones ADD COLUMN radio_channel TEXT;
ALTER TABLE dispatch_zones ADD COLUMN hazard_notes TEXT;
ALTER TABLE dispatch_zones ADD COLUMN population_estimate INTEGER;
ALTER TABLE dispatch_zones ADD COLUMN sq_miles REAL;
ALTER TABLE dispatch_zones ADD COLUMN active INTEGER DEFAULT 1;
ALTER TABLE dispatch_zones ADD COLUMN updated_at TEXT DEFAULT (datetime('now','localtime'));

ALTER TABLE dispatch_beats ADD COLUMN beat_descriptor TEXT;
ALTER TABLE dispatch_beats ADD COLUMN dispatch_code TEXT;
ALTER TABLE dispatch_beats ADD COLUMN assigned_unit TEXT;
ALTER TABLE dispatch_beats ADD COLUMN backup_unit TEXT;
ALTER TABLE dispatch_beats ADD COLUMN hazard_notes TEXT;
ALTER TABLE dispatch_beats ADD COLUMN premise_alerts TEXT DEFAULT '[]';
ALTER TABLE dispatch_beats ADD COLUMN patrol_frequency TEXT DEFAULT 'normal';
ALTER TABLE dispatch_beats ADD COLUMN priority_modifier INTEGER DEFAULT 0;
ALTER TABLE dispatch_beats ADD COLUMN population_estimate INTEGER;
ALTER TABLE dispatch_beats ADD COLUMN sq_miles REAL;
ALTER TABLE dispatch_beats ADD COLUMN min_lat REAL;
ALTER TABLE dispatch_beats ADD COLUMN max_lat REAL;
ALTER TABLE dispatch_beats ADD COLUMN min_lng REAL;
ALTER TABLE dispatch_beats ADD COLUMN max_lng REAL;
ALTER TABLE dispatch_beats ADD COLUMN notes TEXT;
ALTER TABLE dispatch_beats ADD COLUMN active INTEGER DEFAULT 1;
ALTER TABLE dispatch_beats ADD COLUMN updated_at TEXT DEFAULT (datetime('now','localtime'));

-- ── dispatch_codes — add full schema columns ──
ALTER TABLE dispatch_codes ADD COLUMN category TEXT DEFAULT 'general';
ALTER TABLE dispatch_codes ADD COLUMN priority TEXT DEFAULT 'P3';
ALTER TABLE dispatch_codes ADD COLUMN color TEXT DEFAULT '#6b7280';
ALTER TABLE dispatch_codes ADD COLUMN requires_backup INTEGER DEFAULT 0;
ALTER TABLE dispatch_codes ADD COLUMN officer_safety INTEGER DEFAULT 0;
ALTER TABLE dispatch_codes ADD COLUMN ems_needed INTEGER DEFAULT 0;
ALTER TABLE dispatch_codes ADD COLUMN fire_needed INTEGER DEFAULT 0;
ALTER TABLE dispatch_codes ADD COLUMN sort_order INTEGER DEFAULT 0;
ALTER TABLE dispatch_codes ADD COLUMN active INTEGER DEFAULT 1;
ALTER TABLE dispatch_codes ADD COLUMN updated_at TEXT DEFAULT (datetime('now','localtime'));

-- ── PSO columns on calls_for_service (remaining from 0009) ──
ALTER TABLE calls_for_service ADD COLUMN pso_requestor_name TEXT;
ALTER TABLE calls_for_service ADD COLUMN pso_requestor_phone TEXT;
ALTER TABLE calls_for_service ADD COLUMN pso_requestor_email TEXT;
ALTER TABLE calls_for_service ADD COLUMN pso_service_type TEXT;
ALTER TABLE calls_for_service ADD COLUMN pso_billing_code TEXT;
ALTER TABLE calls_for_service ADD COLUMN pso_authorization TEXT;
ALTER TABLE calls_for_service ADD COLUMN pso_attempt_number INTEGER;
ALTER TABLE calls_for_service ADD COLUMN pso_service_windows TEXT;
ALTER TABLE calls_for_service ADD COLUMN process_service_type TEXT;
ALTER TABLE calls_for_service ADD COLUMN process_served_to TEXT;
ALTER TABLE calls_for_service ADD COLUMN process_served_address TEXT;
ALTER TABLE calls_for_service ADD COLUMN process_attempts INTEGER;

-- ── Remaining users columns from 0008 ──
ALTER TABLE users ADD COLUMN territory_zips TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN availability TEXT DEFAULT '{}';
ALTER TABLE users ADD COLUMN performance TEXT DEFAULT '{}';
ALTER TABLE users ADD COLUMN notification_prefs TEXT DEFAULT '{}';
ALTER TABLE users ADD COLUMN theme_preference TEXT DEFAULT 'dark';
ALTER TABLE users ADD COLUMN font_size_preference TEXT DEFAULT 'medium';
ALTER TABLE users ADD COLUMN favorites TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN recently_viewed TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN fitness_scores TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN commendations TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN status_history TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN assignment_history TEXT DEFAULT '[]';
