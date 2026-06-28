-- 0048_specialized_modules.sql
-- Tables for Gang Intel, Narcotics, Special Ops, Crisis Response,
-- Victim Services, Alarm Management, Accreditation, Recruitment.
-- Idempotent: all CREATE TABLE IF NOT EXISTS.

-- Gang Intelligence Members
CREATE TABLE IF NOT EXISTS gang_intel_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  moniker       TEXT,
  gang_name     TEXT,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','incarcerated','deceased')),
  threat_level  TEXT DEFAULT 'low' CHECK(threat_level IN ('low','medium','high','critical')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

-- Gang Intelligence Gangs
CREATE TABLE IF NOT EXISTS gang_intel_gangs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  colors        TEXT,
  member_count  INTEGER DEFAULT 0,
  threat_level  TEXT DEFAULT 'low' CHECK(threat_level IN ('low','medium','high','critical')),
  territory     TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

-- Gang Graffiti Records
CREATE TABLE IF NOT EXISTS gang_graffiti_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  location      TEXT NOT NULL,
  description   TEXT,
  gang_name     TEXT,
  photo_url     TEXT,
  reported_date TEXT NOT NULL DEFAULT (date('now')),
  status        TEXT DEFAULT 'documented' CHECK(status IN ('documented','removed','investigating')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Narcotics Cases
CREATE TABLE IF NOT EXISTS narcotics_cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number   TEXT NOT NULL,
  case_type     TEXT CHECK(case_type IN ('investigation','buy_bust','ci_management','surveillance','other')),
  subject_name  TEXT,
  location      TEXT,
  substance     TEXT,
  quantity      TEXT,
  street_value  REAL DEFAULT 0,
  status        TEXT DEFAULT 'open' CHECK(status IN ('open','active','closed','pending_review')),
  priority      TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  officer_id    INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

-- Special Ops Callouts
CREATE TABLE IF NOT EXISTS special_ops_callouts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  call_type     TEXT NOT NULL,
  location      TEXT,
  resolution    TEXT,
  duration_minutes INTEGER,
  team_size     INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Special Ops Equipment
CREATE TABLE IF NOT EXISTS special_ops_equipment (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_type TEXT NOT NULL,
  serial_number TEXT,
  condition     TEXT DEFAULT 'ready' CHECK(condition IN ('ready','repair','retired','lost')),
  assigned_to   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

-- Crisis Response Incidents
CREATE TABLE IF NOT EXISTS crisis_response_incidents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_number TEXT NOT NULL,
  incident_type TEXT CHECK(incident_type IN ('mental_health','suicide_ideation','substance_abuse','domestic','welfare_check','other')),
  location      TEXT,
  subject_name  TEXT,
  disposition   TEXT,
  cit_team_used INTEGER DEFAULT 0,
  resolved_on_scene INTEGER DEFAULT 0,
  diverted      INTEGER DEFAULT 0,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

-- Victim Services
CREATE TABLE IF NOT EXISTS victim_services_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  victim_name   TEXT NOT NULL,
  case_number   TEXT,
  crime_type    TEXT,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','closed','referred','pending')),
  advocate_id   INTEGER,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  safety_plan   INTEGER DEFAULT 0,
  protective_order INTEGER DEFAULT 0,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

-- Alarm Management Accounts
CREATE TABLE IF NOT EXISTS alarm_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_number TEXT NOT NULL,
  account_name  TEXT NOT NULL,
  address       TEXT NOT NULL,
  contact_name  TEXT,
  contact_phone TEXT,
  permit_number TEXT,
  permit_status TEXT DEFAULT 'active' CHECK(permit_status IN ('active','expired','suspended','pending')),
  permit_expiry TEXT,
  alarm_type    TEXT CHECK(alarm_type IN ('burglary','robbery','panic','fire','medical','other')),
  false_alarm_count INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','no_response')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

-- Accreditation Standards
CREATE TABLE IF NOT EXISTS accreditation_standards (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  standard_number TEXT NOT NULL,
  standard_name TEXT NOT NULL,
  category      TEXT,
  description   TEXT,
  compliance_status TEXT DEFAULT 'pending' CHECK(compliance_status IN ('compliant','non_compliant','pending','in_progress')),
  last_reviewed TEXT,
  next_review   TEXT,
  proof_url     TEXT,
  assigned_to   INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

-- Recruitment Candidates
CREATE TABLE IF NOT EXISTS recruitment_candidates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_name TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  position      TEXT,
  stage         TEXT DEFAULT 'applied' CHECK(stage IN ('applied','screening','testing','oral_board','background','conditional_offer','academy','fto','hired','rejected','withdrawn')),
  applied_date  TEXT NOT NULL DEFAULT (date('now')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
