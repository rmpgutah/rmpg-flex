-- Migration number: 0010    2026-05-23T01:00:00.000Z
-- Create dispatch geography tables (never added to D1 — only existed in Express database.ts)
-- Referenced by dispatch-worker.ts, dispatch-aggregates-worker.ts, GeographyPage.tsx

CREATE TABLE IF NOT EXISTS dispatch_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_code TEXT NOT NULL UNIQUE,
  area_name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  description TEXT,
  commander TEXT,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS dispatch_sectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector_code TEXT NOT NULL UNIQUE,
  sector_name TEXT NOT NULL,
  area_id INTEGER REFERENCES dispatch_areas(id) ON DELETE SET NULL,
  county_nbr TEXT,
  fips_code TEXT,
  color TEXT DEFAULT '#808080',
  description TEXT,
  supervisor TEXT,
  radio_channel TEXT,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS dispatch_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_code TEXT NOT NULL UNIQUE,
  zone_name TEXT NOT NULL,
  sector_id INTEGER REFERENCES dispatch_sectors(id) ON DELETE SET NULL,
  zone_type TEXT DEFAULT 'municipality',
  ugrc_code TEXT,
  color TEXT,
  description TEXT,
  primary_unit TEXT,
  backup_unit TEXT,
  radio_channel TEXT,
  hazard_notes TEXT,
  notes TEXT,
  population_estimate INTEGER,
  sq_miles REAL,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS dispatch_beats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  beat_code TEXT NOT NULL UNIQUE,
  beat_name TEXT NOT NULL,
  beat_descriptor TEXT,
  zone_id INTEGER REFERENCES dispatch_zones(id) ON DELETE SET NULL,
  district_letter TEXT,
  beat_number INTEGER,
  dispatch_code TEXT,
  color TEXT,
  assigned_unit TEXT,
  backup_unit TEXT,
  hazard_notes TEXT,
  premise_alerts TEXT DEFAULT '[]',
  patrol_frequency TEXT DEFAULT 'normal',
  priority_modifier INTEGER DEFAULT 0,
  population_estimate INTEGER,
  sq_miles REAL,
  min_lat REAL,
  max_lat REAL,
  min_lng REAL,
  max_lng REAL,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS dispatch_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  priority TEXT DEFAULT 'P3',
  color TEXT DEFAULT '#6b7280',
  requires_backup INTEGER DEFAULT 0,
  officer_safety INTEGER DEFAULT 0,
  ems_needed INTEGER DEFAULT 0,
  fire_needed INTEGER DEFAULT 0,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

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

-- Seed initial geography data only if tables are empty
INSERT OR IGNORE INTO dispatch_areas (id, area_code, area_name, color, sort_order)
VALUES (1, 'UT', 'Utah', '#d4a017', 1);

INSERT OR IGNORE INTO dispatch_areas (id, area_code, area_name, color, sort_order)
VALUES (2, 'SLC', 'Salt Lake City', '#6366f1', 2);

INSERT OR IGNORE INTO dispatch_areas (id, area_code, area_name, color, sort_order)
VALUES (3, 'WV', 'West Valley', '#22c55e', 3);

INSERT OR IGNORE INTO dispatch_areas (id, area_code, area_name, color, sort_order)
VALUES (4, 'SU', 'Summit County', '#f59e0b', 4);

INSERT OR IGNORE INTO dispatch_areas (id, area_code, area_name, color, sort_order)
VALUES (5, 'WVC', 'West Jordan', '#ef4444', 5);

INSERT OR IGNORE INTO dispatch_areas (id, area_code, area_name, color, sort_order)
VALUES (6, 'PC', 'Park City', '#ec4899', 6);
