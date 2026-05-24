-- RMPG Flex — Initial D1 Schema
-- Core tables for Phase 1 (Auth) + Phase 2 (Dispatch) + Phase 3 (RMS)

-- ─── Users & Auth ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'officer' CHECK(role IN ('admin','manager','dispatcher','supervisor','officer','client_viewer','contract_manager','human_resources')),
  badge_number TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','terminated')),
  avatar_url TEXT,
  totp_secret_encrypted TEXT,
  totp_exempt INTEGER DEFAULT 0,
  totp_enrolled INTEGER DEFAULT 0,
  webauthn_credentials TEXT DEFAULT '[]',
  password_changed_at TEXT,
  force_password_change INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  refresh_token TEXT UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  device_token TEXT,
  expires_at TEXT NOT NULL,
  refresh_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip_address TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER PRIMARY KEY,
  notify_dispatch_email INTEGER DEFAULT 1,
  notify_dispatch_inapp INTEGER DEFAULT 1,
  notify_bolo_email INTEGER DEFAULT 1,
  notify_bolo_inapp INTEGER DEFAULT 1,
  notify_warrant_email INTEGER DEFAULT 0,
  notify_warrant_inapp INTEGER DEFAULT 1,
  notify_system_email INTEGER DEFAULT 0,
  notify_system_inapp INTEGER DEFAULT 1,
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  font_scale REAL DEFAULT 1.0,
  compact_mode INTEGER DEFAULT 0,
  show_map_labels INTEGER DEFAULT 1,
  default_map_style TEXT DEFAULT 'dark',
  dispatch_sort TEXT DEFAULT 'priority',
  theme_preference TEXT DEFAULT 'dark',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Dispatch ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calls_for_service (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_number TEXT UNIQUE,
  incident_type TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('P1','P2','P3','P4')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispatched','enroute','onscene','cleared','closed','cancelled','archived','on_hold')),
  caller_name TEXT,
  caller_phone TEXT,
  location_address TEXT NOT NULL,
  property_id INTEGER,
  latitude REAL,
  longitude REAL,
  description TEXT,
  notes TEXT,
  source TEXT DEFAULT 'phone',
  assigned_unit_ids TEXT DEFAULT '[]',
  unit_call_signs TEXT,
  dispatcher_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  dispatched_at TEXT,
  enroute_at TEXT,
  onscene_at TEXT,
  cleared_at TEXT,
  closed_at TEXT,
  disposition TEXT,
  FOREIGN KEY (dispatcher_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sign TEXT UNIQUE NOT NULL,
  officer_id INTEGER,
  status TEXT NOT NULL DEFAULT 'off_duty' CHECK(status IN ('available','dispatched','enroute','onscene','busy','off_duty','out_of_service')),
  latitude REAL,
  longitude REAL,
  vehicle_id TEXT,
  capabilities TEXT DEFAULT '[]',
  current_call_id INTEGER,
  current_call_number TEXT,
  last_status_change TEXT DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (current_call_id) REFERENCES calls_for_service(id)
);

CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  officer_id INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy REAL,
  heading REAL,
  speed REAL,
  unit_status TEXT,
  call_sign TEXT,
  officer_name TEXT,
  badge_number TEXT,
  current_call_id INTEGER,
  current_call_number TEXT,
  current_call_type TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (unit_id) REFERENCES units(id),
  FOREIGN KEY (officer_id) REFERENCES users(id)
);

-- ─── Geography ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#888888',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dispatch_sectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (area_id) REFERENCES dispatch_areas(id)
);

CREATE TABLE IF NOT EXISTS dispatch_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (sector_id) REFERENCES dispatch_sectors(id)
);

CREATE TABLE IF NOT EXISTS dispatch_beats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  geojson TEXT,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (zone_id) REFERENCES dispatch_zones(id)
);

CREATE TABLE IF NOT EXISTS dispatch_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT,
  priority TEXT DEFAULT 'P3',
  requires_attention INTEGER DEFAULT 0
);

-- ─── RMS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_number TEXT UNIQUE,
  call_id INTEGER,
  incident_type TEXT NOT NULL,
  priority TEXT DEFAULT 'P3',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','under_review','approved','returned')),
  location_address TEXT,
  latitude REAL,
  longitude REAL,
  narrative TEXT,
  officer_id INTEGER NOT NULL,
  supervisor_id INTEGER,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (call_id) REFERENCES calls_for_service(id),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (supervisor_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  dob TEXT,
  gender TEXT,
  race TEXT,
  height TEXT,
  weight TEXT,
  hair_color TEXT,
  eye_color TEXT,
  scars_marks_tattoos TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  photo_url TEXT,
  flags TEXT DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_number TEXT,
  state TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,
  color TEXT,
  vin TEXT,
  owner_person_id INTEGER,
  flags TEXT DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_person_id) REFERENCES persons(id)
);

CREATE TABLE IF NOT EXISTS incident_persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  person_id INTEGER,
  role TEXT NOT NULL CHECK(role IN ('victim','suspect','witness','complainant','arrestee','involved','reporting_party')),
  statement TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES persons(id)
);

CREATE TABLE IF NOT EXISTS incident_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  vehicle_id INTEGER,
  role TEXT DEFAULT 'involved',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles_records(id)
);

CREATE TABLE IF NOT EXISTS incident_offenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  statute_code TEXT,
  description TEXT NOT NULL,
  offense_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS incident_officers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  officer_id INTEGER NOT NULL,
  role TEXT DEFAULT 'primary',
  arrived_at TEXT,
  cleared_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (officer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS incident_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  linked_type TEXT NOT NULL CHECK(linked_type IN ('call','case','warrant','citation','arrest','bolo')),
  linked_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

-- ─── Citations ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  citation_number TEXT UNIQUE,
  person_id INTEGER,
  incident_id INTEGER,
  officer_id INTEGER NOT NULL,
  location TEXT,
  citation_date TEXT NOT NULL DEFAULT (datetime('now')),
  court_date TEXT,
  court TEXT,
  status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','served','void','paid','dismissed','warrant')),
  total_fine REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (person_id) REFERENCES persons(id),
  FOREIGN KEY (incident_id) REFERENCES incidents(id),
  FOREIGN KEY (officer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS citation_violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  citation_id INTEGER NOT NULL,
  statute_code TEXT,
  description TEXT NOT NULL,
  fine_amount REAL DEFAULT 0,
  points INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE
);

-- ─── Warrants ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warrants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warrant_number TEXT UNIQUE,
  person_id INTEGER,
  type TEXT NOT NULL CHECK(type IN ('arrest','bench','search','detention')),
  jurisdiction TEXT,
  issuing_agency TEXT,
  charge TEXT,
  bond_amount REAL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','served','expired','cancelled','recalled')),
  issued_at TEXT,
  expires_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (person_id) REFERENCES persons(id)
);

-- ─── BOLOs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bolos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bolo_number TEXT UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('person','vehicle','other')),
  title TEXT NOT NULL,
  description TEXT,
  subject_description TEXT,
  vehicle_description TEXT,
  photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','cancelled')),
  priority TEXT DEFAULT 'P3',
  issued_by INTEGER NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (issued_by) REFERENCES users(id)
);

-- ─── Evidence ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_number TEXT UNIQUE,
  incident_id INTEGER,
  case_id INTEGER,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  location_found TEXT,
  collected_by INTEGER NOT NULL,
  storage_location TEXT,
  chain_of_custody TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'collected' CHECK(status IN ('collected','stored','transferred','destroyed','returned')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id),
  FOREIGN KEY (collected_by) REFERENCES users(id)
);

-- ─── Activity Log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ─── Notifications ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  type TEXT NOT NULL DEFAULT 'info',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','emergency')),
  title TEXT NOT NULL,
  message TEXT,
  entity_type TEXT,
  entity_id INTEGER,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ─── Indexes ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls_for_service(status);
CREATE INDEX IF NOT EXISTS idx_calls_priority ON calls_for_service(priority);
CREATE INDEX IF NOT EXISTS idx_calls_created ON calls_for_service(created_at);
CREATE INDEX IF NOT EXISTS idx_units_status ON units(status);
CREATE INDEX IF NOT EXISTS idx_incidents_officer ON incidents(officer_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_persons_name ON persons(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles_records(plate_number);
CREATE INDEX IF NOT EXISTS idx_bolos_status ON bolos(status);
CREATE INDEX IF NOT EXISTS idx_citations_status ON citations(status);
CREATE INDEX IF NOT EXISTS idx_warrants_status ON warrants(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gps_recorded ON gps_breadcrumbs(recorded_at);
CREATE INDEX IF NOT EXISTS idx_gps_unit ON gps_breadcrumbs(unit_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh ON sessions(refresh_token);

-- ─── Seed: default admin user (password: admin123) ─────
INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, status, force_password_change)
VALUES (1, 'admin', '$2a$12$LJ3m4ys3Lk0TSwHnbfOMiOXPm1Qlq5Gz0Yq0Yq0Yq0Yq0Yq0Yq0O', 'Administrator', 'admin', 'active', 1);

INSERT OR IGNORE INTO system_config (key, value) VALUES ('db_version', '1.0.0');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('app_name', 'RMPG Flex');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('setup_complete', '0');
