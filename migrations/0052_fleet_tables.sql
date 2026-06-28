-- ============================================================
-- Fleet management tables
-- ============================================================
-- Routes: src/routes/fleet.ts
-- Previously only existed in legacy/server-vps/ (no D1 migration).
-- The /api/fleet Worker routes query these six tables; without them,
-- every handler returns 500 (table-not-found) → the FleetPage is dead.
-- ============================================================

-- ── fleet_vehicles — core vehicle inventory ────────────────
CREATE TABLE IF NOT EXISTS fleet_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_number TEXT NOT NULL UNIQUE,
  make TEXT,
  model TEXT,
  year INTEGER,
  color TEXT,
  vin TEXT,
  plate_number TEXT,
  plate_state TEXT DEFAULT 'UT',
  status TEXT NOT NULL DEFAULT 'in_service'
    CHECK(status IN ('in_service','out_of_service','maintenance','retired','archived')),
  assigned_unit_id INTEGER REFERENCES units(id),
  current_mileage INTEGER,
  last_service_date TEXT,
  next_service_due TEXT,
  next_service_mileage INTEGER,
  insurance_expiry TEXT,
  registration_expiry TEXT,
  equipment TEXT DEFAULT '[]',
  notes TEXT,
  -- Soft-delete (DELETE /api/fleet/:id sets status='archived' + archived_at)
  archived_at TEXT,
  -- Materialized aggregates (updated by the legacy addCol migration)
  total_maintenance_cost REAL DEFAULT 0,
  total_fuel_cost REAL DEFAULT 0,
  avg_mpg REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_assignments — unit-to-vehicle assignment log ─────
CREATE TABLE IF NOT EXISTS fleet_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id),
  unit_call_sign TEXT,
  officer_name TEXT,
  assigned_at TEXT,
  unassigned_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_maintenance — service records ────────────────────
CREATE TABLE IF NOT EXISTS fleet_maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  type TEXT CHECK(type IN ('routine','repair','inspection','recall','other')),
  description TEXT,
  mileage_at_service INTEGER,
  cost REAL,
  vendor TEXT,
  performed_by TEXT,
  performed_at TEXT,
  next_due_date TEXT,
  next_due_mileage INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_fuel_log — fuel purchase records ─────────────────
CREATE TABLE IF NOT EXISTS fleet_fuel_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  fuel_date TEXT NOT NULL,
  gallons REAL,
  total_cost REAL,
  odometer INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_inspections — periodic safety/equipment checks ───
CREATE TABLE IF NOT EXISTS fleet_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  inspection_date TEXT NOT NULL,
  overall_result TEXT NOT NULL DEFAULT 'pass'
    CHECK(overall_result IN ('pass','fail','conditional')),
  inspector_id INTEGER REFERENCES users(id),
  mileage_at_inspection INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_insurance — policy / carrier tracking ────────────
CREATE TABLE IF NOT EXISTS fleet_insurance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  carrier TEXT,
  policy_number TEXT,
  coverage_type TEXT,
  coverage_amount REAL,
  premium REAL,
  effective_date TEXT,
  expiry_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── fleet_registration — DMV registration records ──────────
CREATE TABLE IF NOT EXISTS fleet_registration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  state TEXT DEFAULT 'UT',
  registration_number TEXT,
  effective_date TEXT,
  expiry_date TEXT,
  renewal_status TEXT DEFAULT 'current'
    CHECK(renewal_status IN ('current','pending','expired')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── dashcam_videos — recorded footage index ────────────────
-- Query exists in fleet.ts GET /dashcam-videos but degrades
-- gracefully when the table is missing. Create it now so the
-- degradation path disappears.
CREATE TABLE IF NOT EXISTS dashcam_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  title TEXT,
  case_number TEXT,
  notes TEXT,
  classification TEXT,
  file_size INTEGER,
  duration_seconds INTEGER,
  recorded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
