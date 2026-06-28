-- Migration: 0001_initial_schema.sql
-- Created: 2026-05-20
-- Description: Initial D1 schema for RMPG Flex CAD/RMS

-- Core tables
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK(role IN ('admin','manager','dispatcher','supervisor','officer','client_viewer','contract_manager','human_resources')),
  badge_number TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','terminated')),
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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
  notify_credential_email INTEGER DEFAULT 1,
  notify_credential_inapp INTEGER DEFAULT 1,
  notify_pso_email INTEGER DEFAULT 1,
  notify_pso_inapp INTEGER DEFAULT 1,
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  font_scale REAL DEFAULT 1.0,
  compact_mode INTEGER DEFAULT 0,
  show_map_labels INTEGER DEFAULT 1,
  default_map_style TEXT DEFAULT 'dark',
  dashboard_widgets TEXT,
  dispatch_sort TEXT DEFAULT 'priority',
  dispatch_show_cleared INTEGER DEFAULT 0,
  theme_preference TEXT DEFAULT 'dark',
  font_size_preference TEXT DEFAULT 'medium',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  contract_start TEXT,
  contract_end TEXT,
  sla_response_minutes INTEGER DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT,
  state TEXT,
  zip TEXT,
  latitude REAL,
  longitude REAL,
  property_type TEXT,
  gate_code TEXT,
  alarm_code TEXT,
  emergency_contact TEXT,
  post_orders TEXT,
  hazard_notes TEXT,
  access_instructions TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  business_type TEXT,
  structure_type TEXT,
  occupancy_status TEXT,
  year_built TEXT,
  square_footage TEXT,
  number_of_stories TEXT,
  security_features TEXT,
  key_holder_name TEXT,
  key_holder_phone TEXT,
  key_holder_relationship TEXT,
  owner_name TEXT,
  owner_phone TEXT,
  last_inspection_date TEXT,
  inspection_status TEXT,
  alarm_company TEXT,
  alarm_account TEXT,
  camera_system TEXT,
  parking_info TEXT,
  roof_access TEXT,
  utility_shutoffs TEXT,
  known_hazards TEXT,
  contact_email TEXT,
  secondary_contact_name TEXT,
  secondary_contact_phone TEXT,
  patrol_frequency TEXT,
  opening_hours TEXT,
  closing_hours TEXT,
  updated_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS calls_for_service (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_number TEXT UNIQUE,
  incident_type TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('P1','P2','P3','P4')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispatched','enroute','onscene','cleared','closed','cancelled','archived')),
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
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (dispatcher_id) REFERENCES users(id)
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
  recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (unit_id) REFERENCES units(id),
  FOREIGN KEY (officer_id) REFERENCES users(id)
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
  last_status_change TEXT DEFAULT (datetime('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (current_call_id) REFERENCES calls_for_service(id)
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_number TEXT UNIQUE,
  call_id INTEGER,
  incident_type TEXT NOT NULL,
  priority TEXT DEFAULT 'P3',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','under_review','approved','returned')),
  location_address TEXT,
  property_id INTEGER,
  latitude REAL,
  longitude REAL,
  narrative TEXT,
  officer_id INTEGER NOT NULL,
  supervisor_id INTEGER,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (call_id) REFERENCES calls_for_service(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
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
  updated_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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
  updated_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (owner_person_id) REFERENCES persons(id)
);

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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (issued_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER,
  channel TEXT NOT NULL DEFAULT 'direct' CHECK(channel IN ('direct','dispatch','broadcast','zone')),
  content TEXT NOT NULL,
  priority TEXT DEFAULT 'routine' CHECK(priority IN ('routine','urgent','emergency')),
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (from_user_id) REFERENCES users(id),
  FOREIGN KEY (to_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_number TEXT,
  incident_id INTEGER NOT NULL,
  description TEXT,
  evidence_type TEXT,
  storage_location TEXT,
  collected_by INTEGER,
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','in_storage','submitted_to_le','released','disposed')),
  chain_of_custody TEXT DEFAULT '[]',
  updated_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id),
  FOREIGN KEY (collected_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  property_id INTEGER,
  shift_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','active','completed','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (property_id) REFERENCES properties(id)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  schedule_id INTEGER,
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  clock_in_latitude REAL,
  clock_in_longitude REAL,
  total_hours REAL,
  break_start TEXT,
  break_minutes REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','edited','on_break')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (schedule_id) REFERENCES schedules(id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  credential_type TEXT NOT NULL,
  credential_number TEXT,
  issued_date TEXT,
  expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','pending_renewal')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS patrol_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  latitude REAL,
  longitude REAL,
  qr_code TEXT,
  sequence_order INTEGER DEFAULT 0,
  scan_required_interval_minutes INTEGER NOT NULL DEFAULT 60,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (property_id) REFERENCES properties(id)
);

CREATE TABLE IF NOT EXISTS patrol_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkpoint_id INTEGER NOT NULL,
  officer_id INTEGER NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  latitude REAL,
  longitude REAL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'on_time' CHECK(status IN ('on_time','late','missed')),
  FOREIGN KEY (checkpoint_id) REFERENCES patrol_checkpoints(id),
  FOREIGN KEY (officer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip_address TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT UNIQUE NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  uploaded_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT NOT NULL,
  config_value TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_config_key_value ON system_config(config_key, config_value);

-- Warrants
CREATE TABLE IF NOT EXISTS warrants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warrant_number TEXT UNIQUE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  subject_name TEXT,
  subject_dob TEXT,
  offense TEXT,
  court TEXT,
  judge TEXT,
  bond_amount REAL,
  issued_date TEXT,
  expiry_date TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Migration version tracking
CREATE TABLE IF NOT EXISTS migration_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0,
  last_migrated_at TEXT
);

-- Initialize migration version
INSERT OR IGNORE INTO migration_version (id, version, last_migrated_at) VALUES (1, 1, datetime('now','localtime'));
