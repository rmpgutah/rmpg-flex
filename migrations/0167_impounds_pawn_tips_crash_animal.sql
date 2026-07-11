-- Migration 0167: backend tables for 5 client pages that shipped with no
-- matching server route at all (ImpoundPage, PawnTrackingPage, TipsPage,
-- CrashReportsPage, AnimalControlPage) — every request 404'd since these
-- pages were added. Found during a 2026-07-02 dead-endpoint sweep.

CREATE TABLE IF NOT EXISTS impounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_year TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  vehicle_vin TEXT,
  license_plate TEXT,
  license_state TEXT,
  tow_company TEXT,
  tow_driver TEXT,
  lot_location TEXT,
  lot_space TEXT,
  impound_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  release_date TEXT,
  reason TEXT NOT NULL,
  authority TEXT,
  hold_flag INTEGER DEFAULT 0,
  hold_reason TEXT,
  daily_fee REAL DEFAULT 25,
  tow_fee REAL DEFAULT 150,
  total_fees REAL,
  status TEXT NOT NULL DEFAULT 'impounded' CHECK(status IN ('impounded','hold','released','auction')),
  owner_name TEXT,
  owner_phone TEXT,
  owner_notified INTEGER DEFAULT 0,
  owner_notified_date TEXT,
  call_id INTEGER REFERENCES calls_for_service(id),
  incident_id INTEGER,
  officer_id INTEGER REFERENCES users(id),
  photos TEXT,
  property_inventory TEXT,
  notes TEXT,
  days_stored INTEGER,
  released_to TEXT,
  release_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_impounds_status ON impounds(status);
CREATE INDEX IF NOT EXISTS idx_impounds_plate ON impounds(license_plate);
CREATE INDEX IF NOT EXISTS idx_impounds_vin ON impounds(vehicle_vin);

CREATE TABLE IF NOT EXISTS pawn_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_name TEXT NOT NULL,
  shop_address TEXT,
  transaction_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  transaction_type TEXT NOT NULL DEFAULT 'pawn' CHECK(transaction_type IN ('pawn','buy','sell')),
  item_description TEXT NOT NULL,
  item_category TEXT,
  serial_number TEXT,
  brand TEXT,
  model TEXT,
  color TEXT,
  seller_first_name TEXT,
  seller_last_name TEXT,
  seller_dob TEXT,
  seller_id_type TEXT,
  seller_id_number TEXT,
  seller_address TEXT,
  seller_phone TEXT,
  hold_period_days INTEGER DEFAULT 30,
  hold_expires TEXT,
  status TEXT NOT NULL DEFAULT 'held' CHECK(status IN ('held','released','flagged','seized','returned')),
  flagged_stolen INTEGER DEFAULT 0,
  matched_evidence_id INTEGER,
  amount REAL,
  notes TEXT,
  entered_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pawn_status ON pawn_transactions(status);
CREATE INDEX IF NOT EXISTS idx_pawn_serial ON pawn_transactions(serial_number);
CREATE INDEX IF NOT EXISTS idx_pawn_seller ON pawn_transactions(seller_last_name, seller_first_name);

-- Investigative tip line — distinct from `public_tips` (the anonymous
-- community-portal submission table in community.ts). This is the
-- detective-facing tracked/assigned/linked-to-case tip queue TipsPage.tsx
-- expects.
CREATE TABLE IF NOT EXISTS investigative_tips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_number TEXT NOT NULL UNIQUE,
  received_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  tip_type TEXT,
  description TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'routine' CHECK(urgency IN ('immediate','urgent','routine')),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewed','investigating','actionable','closed')),
  assigned_to INTEGER REFERENCES users(id),
  source TEXT,
  location TEXT,
  linked_case_id INTEGER REFERENCES cases(id),
  notes TEXT,
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_investigative_tips_status ON investigative_tips(status);
CREATE INDEX IF NOT EXISTS idx_investigative_tips_assigned ON investigative_tips(assigned_to);

CREATE TABLE IF NOT EXISTS crash_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_number TEXT NOT NULL UNIQUE,
  crash_date TEXT NOT NULL,
  location TEXT NOT NULL,
  crash_type TEXT NOT NULL DEFAULT 'vehicle_vehicle',
  severity TEXT NOT NULL DEFAULT 'property_damage_only',
  vehicles_involved INTEGER DEFAULT 0,
  injuries INTEGER DEFAULT 0,
  fatalities INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_review','approved','filed','amended')),
  narrative TEXT,
  weather_conditions TEXT,
  road_conditions TEXT,
  parties_description TEXT,
  investigating_officer TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_crash_reports_status ON crash_reports(status);
CREATE INDEX IF NOT EXISTS idx_crash_reports_date ON crash_reports(crash_date);

CREATE TABLE IF NOT EXISTS animal_control_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number TEXT NOT NULL UNIQUE,
  case_type TEXT NOT NULL DEFAULT 'complaint',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','quarantine','resolved','closed','transferred')),
  animal_type TEXT,
  breed TEXT,
  animal_name TEXT,
  animal_color TEXT,
  animal_sex TEXT,
  animal_weight TEXT,
  microchip_id TEXT,
  rabies_tag TEXT,
  owner_first_name TEXT,
  owner_last_name TEXT,
  owner_phone TEXT,
  owner_address TEXT,
  location TEXT,
  description TEXT,
  notes TEXT,
  officer_name TEXT,
  assigned_officer_id INTEGER REFERENCES users(id),
  quarantine_start TEXT,
  quarantine_end TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_animal_control_status ON animal_control_cases(status);
CREATE INDEX IF NOT EXISTS idx_animal_control_type ON animal_control_cases(case_type);
