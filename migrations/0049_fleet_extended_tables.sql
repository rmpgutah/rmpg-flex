-- ============================================================
-- Fleet extended tables — sub-resources + advanced features
-- ============================================================
-- Routes: src/routes/fleet.ts (Features 50-250)
-- All idempotent CREATE TABLE IF NOT EXISTS.
-- ============================================================

-- ── fleet_tires — tire inventory & tracking ───────────────
CREATE TABLE IF NOT EXISTS fleet_tires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  tire_position TEXT CHECK(tire_position IN ('FL','FR','RL','RR','spare')),
  brand TEXT,
  model TEXT,
  size TEXT,
  dot_code TEXT,
  tread_depth REAL,
  pressure_psi REAL,
  installed_date TEXT,
  installed_mileage INTEGER,
  removed_date TEXT,
  removed_mileage INTEGER,
  cost REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_damage — damage/incident records ────────────────
CREATE TABLE IF NOT EXISTS fleet_damage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  damage_type TEXT,
  location TEXT,
  severity TEXT CHECK(severity IN ('minor','moderate','major','totaled')),
  description TEXT,
  reported_by TEXT,
  reported_date TEXT,
  repair_cost REAL,
  repair_status TEXT DEFAULT 'pending' CHECK(repair_status IN ('pending','in_progress','completed','declined')),
  repair_date TEXT,
  photo_urls TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_recalls — NHTSA/manufacturer recall tracking ────
CREATE TABLE IF NOT EXISTS fleet_recalls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  nhtsa_number TEXT,
  description TEXT NOT NULL,
  severity TEXT DEFAULT 'medium' CHECK(severity IN ('low','medium','high','critical')),
  issue_date TEXT,
  remedy_date TEXT,
  status TEXT DEFAULT 'open' CHECK(status IN ('open','scheduled','remedied','closed')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_personnel_notes — officer/operator notes per vehicle ─
CREATE TABLE IF NOT EXISTS fleet_personnel_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_pretrip_checklists — DVIR / pre-trip inspections ─
CREATE TABLE IF NOT EXISTS fleet_pretrip_checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  officer_id INTEGER REFERENCES users(id),
  check_date TEXT NOT NULL,
  lights INTEGER DEFAULT 0,
  brakes INTEGER DEFAULT 0,
  radio INTEGER DEFAULT 0,
  mdt INTEGER DEFAULT 0,
  dashcam INTEGER DEFAULT 0,
  tires INTEGER DEFAULT 0,
  fluids INTEGER DEFAULT 0,
  exterior INTEGER DEFAULT 0,
  interior INTEGER DEFAULT 0,
  emergency_equip INTEGER DEFAULT 0,
  notes TEXT,
  status TEXT DEFAULT 'completed' CHECK(status IN ('completed','failed','partial')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_parts — parts inventory management ──────────────
CREATE TABLE IF NOT EXISTS fleet_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  unit_cost REAL,
  quantity_on_hand INTEGER DEFAULT 0,
  reorder_point INTEGER DEFAULT 0,
  supplier TEXT,
  compatible_vehicles TEXT,
  location TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_warranties — warranty/coverage tracking ─────────
CREATE TABLE IF NOT EXISTS fleet_warranties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  coverage_type TEXT NOT NULL,
  provider TEXT,
  policy_number TEXT,
  coverage_details TEXT,
  start_date TEXT,
  expiry_date TEXT,
  expiry_mileage INTEGER,
  deductible REAL,
  contact_info TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','expired','claimed','void')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_depreciation — depreciation schedule ────────────
CREATE TABLE IF NOT EXISTS fleet_depreciation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  purchase_price REAL,
  salvage_value REAL DEFAULT 0,
  useful_life_months INTEGER DEFAULT 60,
  depreciation_method TEXT DEFAULT 'straight_line' CHECK(depreciation_method IN ('straight_line','declining_balance','sum_of_years')),
  monthly_depreciation REAL DEFAULT 0,
  accumulated_depreciation REAL DEFAULT 0,
  current_book_value REAL,
  calculated_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_accidents — accident/incident reporting ─────────
CREATE TABLE IF NOT EXISTS fleet_accidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  accident_date TEXT,
  location TEXT,
  severity TEXT DEFAULT 'minor' CHECK(severity IN ('minor','moderate','major','fatal')),
  description TEXT,
  driver_id INTEGER REFERENCES users(id),
  weather_conditions TEXT,
  road_conditions TEXT,
  police_report_number TEXT,
  insurance_claim_number TEXT,
  estimated_damage REAL,
  injuries INTEGER DEFAULT 0,
  fault_determination TEXT CHECK(fault_determination IN ('at_fault','not_at_fault','shared','pending')),
  status TEXT DEFAULT 'open' CHECK(status IN ('open','investigating','closed','litigation')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_keys — key control / tracking ───────────────────
CREATE TABLE IF NOT EXISTS fleet_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  key_number TEXT DEFAULT '1',
  key_type TEXT DEFAULT 'ignition' CHECK(key_type IN ('ignition','door','remote','master','spare')),
  rfid_tag TEXT UNIQUE,
  status TEXT DEFAULT 'available' CHECK(status IN ('available','checked_out','lost','destroyed')),
  current_holder TEXT,
  last_checkout TEXT,
  last_return TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_key_log — key checkout/return audit trail ───────
CREATE TABLE IF NOT EXISTS fleet_key_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id INTEGER NOT NULL REFERENCES fleet_keys(id) ON DELETE CASCADE,
  action TEXT CHECK(action IN ('checkout','return','lost','destroyed')),
  holder_name TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_service_providers — vendor/shop directory ───────
CREATE TABLE IF NOT EXISTS fleet_service_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider_type TEXT DEFAULT 'general' CHECK(provider_type IN ('general','mechanic','body_shop','tire_shop','dealer','fuel_vendor','detailer','other')),
  phone TEXT,
  email TEXT,
  address TEXT,
  contact_name TEXT,
  tax_id TEXT,
  preferred INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_fuel_cards — fuel card management ───────────────
CREATE TABLE IF NOT EXISTS fleet_fuel_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_number TEXT NOT NULL UNIQUE,
  provider TEXT,
  assigned_vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  pin TEXT,
  credit_limit REAL,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','suspended','cancelled','expired')),
  expiration_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_budgets — budget allocation / tracking ──────────
CREATE TABLE IF NOT EXISTS fleet_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year INTEGER NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('fuel','maintenance','insurance','registration','parts','tires','repairs','depreciation','misc')),
  allocated_amount REAL NOT NULL,
  spent_amount REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_replacement_plan — vehicle replacement schedule ─
CREATE TABLE IF NOT EXISTS fleet_replacement_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  replacement_year INTEGER,
  replacement_reason TEXT,
  estimated_replacement_cost REAL,
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
  status TEXT DEFAULT 'planned' CHECK(status IN ('planned','budgeted','ordered','replaced','deferred')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_accessories — installed equipment / upfits ──────
CREATE TABLE IF NOT EXISTS fleet_accessories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT CHECK(category IN ('lighting','communications','computing','storage','weapon_mount','camera','sensor','emergency','other')),
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  installed_date TEXT,
  installed_mileage INTEGER,
  cost REAL,
  warranty_expiry TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','removed','damaged','replaced')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_utility_costs — recurring utility/overhead costs ─
CREATE TABLE IF NOT EXISTS fleet_utility_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  cost_type TEXT CHECK(cost_type IN ('insurance','registration','tax','storage','cleaning','toll','parking','misc')),
  amount REAL NOT NULL,
  billing_period TEXT,
  due_date TEXT,
  paid INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_telemetry — GPS/telematics data points ─────────
-- Separate from the main vehicle table to keep it lean.
CREATE TABLE IF NOT EXISTS fleet_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  latitude REAL,
  longitude REAL,
  speed_mph REAL,
  heading INTEGER,
  engine_rpm INTEGER,
  fuel_level_pct REAL,
  odometer INTEGER,
  battery_voltage REAL,
  dtc_codes TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_time ON fleet_telemetry(vehicle_id, recorded_at);
