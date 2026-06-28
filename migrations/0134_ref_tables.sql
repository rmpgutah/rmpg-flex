-- Fleet.io PR 2 — cross-reference / lookup table DDL.
-- Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md
-- Pairs with 0135_ref_seed.sql (static lookups) and 0133_fleetio_sync_tables.sql.
--
-- Conventions:
--   * Every table is CREATE TABLE IF NOT EXISTS (D1 deploy step is
--     continue-on-error; the route layer self-heals missing tables/columns).
--   * Every lookup row carries a stable `code` TEXT UNIQUE that the rest of
--     the codebase joins against by string, so seed deletes/replays cannot
--     change row meaning. Display strings (`name`) are mutable.
--   * Indexes are CREATE INDEX IF NOT EXISTS on the join keys callers
--     actually use (per CLAUDE.md gotcha #5 / `[[project-d1-schema-drift-audit]]`).
--   * Apply DIRECTLY to live D1 `785de7ae` after merge and verify with
--     `pragma_table_info('<table>')`.

-- ===================================================================
-- Vehicle reference
-- ===================================================================

CREATE TABLE IF NOT EXISTS ref_vehicle_makes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'TOYT', 'FORD' (NHTSA vPIC + Spillman flavor)
  name TEXT NOT NULL,                  -- 'Toyota', 'Ford'
  nhtsa_make_id INTEGER,               -- vPIC MakeId; null until decoder fills it
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ref_vehicle_makes_name
  ON ref_vehicle_makes (name);

CREATE TABLE IF NOT EXISTS ref_vehicle_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  make_id INTEGER NOT NULL,            -- FK -> ref_vehicle_makes(id)
  code TEXT NOT NULL,                  -- 'CAMRY', 'F150'
  name TEXT NOT NULL,                  -- 'Camry', 'F-150'
  nhtsa_model_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (make_id, code)
);
CREATE INDEX IF NOT EXISTS idx_ref_vehicle_models_make
  ON ref_vehicle_models (make_id);

CREATE TABLE IF NOT EXISTS ref_vehicle_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'PATROL', 'UNMARKED', 'SUPV', 'PURSUIT', 'TRANSPORT'
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_body_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'SED', 'SUV', 'TRUCK', 'VAN'
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_drivetrains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'FWD', 'RWD', 'AWD', '4WD'
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_transmission_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'AUTO', 'MANUAL', 'CVT'
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_engine_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'V6', 'V8', 'I4', 'EV', 'HYB'
  name TEXT NOT NULL,
  cylinders INTEGER,
  displacement_l REAL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_fuel_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'GAS', 'DIESEL', 'EV', 'HYB', 'CNG'
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_colors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- NCIC color codes when applicable ('WHI','BLK','SIL')
  name TEXT NOT NULL,
  hex TEXT,                            -- '#FFFFFF' for UI swatches
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_plate_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- '2-letter USPS': 'UT', 'CO', 'DC'
  name TEXT NOT NULL,                  -- 'Utah', 'Colorado', 'District of Columbia'
  country TEXT NOT NULL DEFAULT 'US',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_tire_sizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'P245/65R17', 'LT265/70R17'
  width_mm INTEGER,
  aspect_ratio INTEGER,
  diameter_in INTEGER,
  load_index TEXT,
  speed_rating TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_oil_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- '5W30-SYNTH', '0W20-SYNTH-BLEND'
  name TEXT NOT NULL,                  -- '5W-30 Full Synthetic'
  viscosity TEXT,                      -- '5W-30'
  base TEXT,                           -- 'synthetic' | 'synthetic_blend' | 'conventional'
  active INTEGER NOT NULL DEFAULT 1
);

-- ===================================================================
-- Maintenance reference
-- ===================================================================

CREATE TABLE IF NOT EXISTS ref_vmrs_systems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- TMC VMRS 3-digit system code: '013', '042'
  name TEXT NOT NULL,                  -- 'Brakes', 'Electrical'
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_vmrs_assemblies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_code TEXT NOT NULL,           -- joins ref_vmrs_systems(code)
  code TEXT NOT NULL,                  -- assembly code within the system
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (system_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ref_vmrs_assemblies_system
  ON ref_vmrs_assemblies (system_code);

CREATE TABLE IF NOT EXISTS ref_vmrs_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_code TEXT NOT NULL,
  assembly_code TEXT NOT NULL,
  code TEXT NOT NULL,                  -- component code within the assembly
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (system_code, assembly_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ref_vmrs_components_system_assembly
  ON ref_vmrs_components (system_code, assembly_code);

CREATE TABLE IF NOT EXISTS ref_service_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'OIL_CHANGE', 'TIRE_ROTATION', 'BRAKE_PAD'
  name TEXT NOT NULL,
  default_interval_miles INTEGER,
  default_interval_days INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_part_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'BRAKES', 'FILTERS', 'FLUIDS'
  name TEXT NOT NULL,
  parent_code TEXT,                    -- for two-level taxonomies
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,            -- vendor SKU or internal code
  name TEXT NOT NULL,
  category_code TEXT,                  -- joins ref_part_categories(code)
  vmrs_system_code TEXT,
  vmrs_assembly_code TEXT,
  vmrs_component_code TEXT,
  default_unit_cost REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ref_parts_category
  ON ref_parts (category_code);
CREATE INDEX IF NOT EXISTS idx_ref_parts_vmrs
  ON ref_parts (vmrs_system_code, vmrs_assembly_code, vmrs_component_code);

CREATE TABLE IF NOT EXISTS ref_labor_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'SHOP_STD', 'AFTER_HOURS', 'DEALER'
  name TEXT NOT NULL,
  hourly_rate REAL NOT NULL,
  effective_at TEXT NOT NULL DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_work_order_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'PM', 'REPAIR', 'INSPECTION', 'BODYWORK'
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- ===================================================================
-- Fuel reference
-- ===================================================================

CREATE TABLE IF NOT EXISTS ref_fuel_grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'REGULAR', 'PREMIUM', 'DIESEL', 'DEF'
  name TEXT NOT NULL,
  octane INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_fuel_card_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'WEX', 'FLEETCOR', 'VOYAGER', 'INTERNAL'
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- ===================================================================
-- Shared
-- ===================================================================

CREATE TABLE IF NOT EXISTS ref_vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fuel','shop','parts','insurance','vendor')),
  external_id TEXT,                    -- Fleet.io vendor id, or fuel-card vendor id
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  lat REAL,
  lng REAL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ref_vendors_kind
  ON ref_vendors (kind, active);
CREATE INDEX IF NOT EXISTS idx_ref_vendors_geo
  ON ref_vendors (lat, lng);

CREATE TABLE IF NOT EXISTS ref_units_of_measure (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- 'gal','qt','L','mi','km','hr','min','ea','kg','lb'
  name TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('volume','distance','time','count','mass')),
  active INTEGER NOT NULL DEFAULT 1
);

-- ===================================================================
-- Cross-reference (xref) tables — autofill rules
-- ===================================================================

CREATE TABLE IF NOT EXISTS xref_make_to_default_oil (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  make_code TEXT NOT NULL,
  oil_code TEXT NOT NULL,
  capacity_qts REAL,
  notes TEXT,
  UNIQUE (make_code, oil_code)
);

CREATE TABLE IF NOT EXISTS xref_model_year_to_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  make_code TEXT NOT NULL,
  model_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  tire_size TEXT,
  oil_code TEXT,
  oil_capacity_qts REAL,
  coolant_capacity_qts REAL,
  gvwr_lbs INTEGER,
  drivetrain_code TEXT,
  transmission_code TEXT,
  engine_code TEXT,
  fuel_type_code TEXT,
  source TEXT,                         -- 'nhtsa' | 'manual' | 'oem'
  UNIQUE (make_code, model_code, year)
);
CREATE INDEX IF NOT EXISTS idx_xref_model_year_lookup
  ON xref_model_year_to_specs (make_code, model_code, year);

CREATE TABLE IF NOT EXISTS xref_vehicle_type_to_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_type_code TEXT NOT NULL UNIQUE,    -- 'PATROL', 'UNMARKED'
  inspection_template_id INTEGER NOT NULL,   -- FK -> inspection_templates (created in PR 6)
  notes TEXT
);

CREATE TABLE IF NOT EXISTS xref_vmrs_to_default_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vmrs_system_code TEXT NOT NULL,
  vmrs_assembly_code TEXT,
  vmrs_component_code TEXT,
  part_sku TEXT NOT NULL,
  frequency_rank INTEGER NOT NULL DEFAULT 0  -- usage count, drives "suggested" sort
);
CREATE INDEX IF NOT EXISTS idx_xref_vmrs_to_parts_lookup
  ON xref_vmrs_to_default_parts (vmrs_system_code, vmrs_assembly_code, vmrs_component_code);

CREATE TABLE IF NOT EXISTS xref_vendor_to_recent_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL,                -- FK -> ref_vendors(id)
  part_sku TEXT NOT NULL,
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  usage_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (vendor_id, part_sku)
);
CREATE INDEX IF NOT EXISTS idx_xref_vendor_recent_parts
  ON xref_vendor_to_recent_parts (vendor_id, last_used_at);

-- ===================================================================
-- VIN decode cache
-- ===================================================================

CREATE TABLE IF NOT EXISTS vin_decode_cache (
  vin TEXT PRIMARY KEY,                      -- 17-char VIN
  decoded_json TEXT NOT NULL,                -- NHTSA vPIC normalized payload
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL DEFAULT 'nhtsa_vpic'  -- forward-compat: 'oem' for direct OEM lookups
);
CREATE INDEX IF NOT EXISTS idx_vin_decode_cache_fetched
  ON vin_decode_cache (fetched_at);
