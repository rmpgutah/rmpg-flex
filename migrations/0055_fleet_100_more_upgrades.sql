-- ============================================================
-- Fleet 100-More-Upgrade Tables — Features 351-450
-- ============================================================
CREATE TABLE IF NOT EXISTS fleet_driver_certs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  cert_type TEXT NOT NULL,
  cert_number TEXT,
  issuer TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_driver_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  incident_type TEXT CHECK(incident_type IN ('accident','violation','complaint','other')),
  incident_date TEXT,
  description TEXT,
  severity TEXT DEFAULT 'minor',
  action_taken TEXT,
  status TEXT DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_driver_vehicle_training (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  training_type TEXT,
  trained_date TEXT,
  trainer_id INTEGER REFERENCES users(id),
  expiry_date TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_driver_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  rating INTEGER CHECK(rating BETWEEN 1 AND 5),
  feedback_text TEXT,
  category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_equipment_calibrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_type TEXT NOT NULL,
  equipment_id TEXT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  last_calibrated TEXT,
  next_calibration_due TEXT,
  calibration_standard TEXT,
  passed INTEGER DEFAULT 1,
  technician TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_vehicle_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vehicle_type TEXT,
  make TEXT,
  model TEXT,
  base_cost REAL,
  equipment_package TEXT,
  ordering_code TEXT,
  is_active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_procurement_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_id INTEGER REFERENCES fleet_vehicle_specs(id),
  order_number TEXT,
  vendor TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price REAL,
  total_price REAL,
  order_date TEXT,
  expected_delivery TEXT,
  status TEXT DEFAULT 'ordered',
  approved_by INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_vendor_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procurement_order_id INTEGER REFERENCES fleet_procurement_orders(id),
  vendor TEXT NOT NULL,
  bid_amount REAL,
  delivery_days INTEGER,
  warranty_details TEXT,
  selected INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_decommissioning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  decommission_date TEXT,
  reason TEXT,
  equipment_stripped INTEGER DEFAULT 0,
  data_wiped INTEGER DEFAULT 0,
  environmental_cleared INTEGER DEFAULT 0,
  salvage_value REAL,
  disposal_method TEXT,
  completed_by INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_vehicle_theft (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  theft_date TEXT,
  location TEXT,
  police_report_number TEXT,
  insurance_claim_number TEXT,
  recovered INTEGER DEFAULT 0,
  recovery_date TEXT,
  recovery_condition TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
