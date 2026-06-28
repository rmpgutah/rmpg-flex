-- ============================================================
-- Fleet 100-Upgrade Tables — Features 251-350
-- ============================================================
-- All idempotent CREATE TABLE IF NOT EXISTS.
-- ============================================================

-- Feature 251-253: Fuel anomaly / theft detection
CREATE TABLE IF NOT EXISTS fleet_fuel_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuel_log_id INTEGER REFERENCES fleet_fuel_log(id),
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  anomaly_type TEXT CHECK(anomaly_type IN ('theft','unusual_volume','off_hours','mismatch_odometer','duplicate','suspicious')),
  score REAL DEFAULT 0,
  details TEXT,
  reviewed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 252: Fuel vendor price tracking
CREATE TABLE IF NOT EXISTS fleet_fuel_vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  brand TEXT,
  current_price_per_gallon REAL,
  last_updated TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 255: Fuel reconciliation
CREATE TABLE IF NOT EXISTS fleet_fuel_reconciliation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  period_start TEXT,
  period_end TEXT,
  card_total REAL,
  manual_total REAL,
  variance REAL,
  notes TEXT,
  reconciled_by INTEGER REFERENCES users(id),
  reconciled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 258: Alternative fuel tracking
CREATE TABLE IF NOT EXISTS fleet_alt_fuel_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  fuel_type TEXT CHECK(fuel_type IN ('electric','hybrid','cng','propane','biodiesel','hydrogen')),
  charge_kwh REAL,
  gge_equivalent REAL,
  cost REAL,
  charge_start TEXT,
  charge_end TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 262: Fuel cost per mile ranking
CREATE TABLE IF NOT EXISTS fleet_fuel_efficiency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id) UNIQUE,
  period_start TEXT,
  period_end TEXT,
  total_miles REAL,
  total_gallons REAL,
  avg_mpg REAL,
  cost_per_mile REAL,
  rank INTEGER,
  calculated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 267: Maintenance vendor ratings
CREATE TABLE IF NOT EXISTS fleet_vendor_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_provider_id INTEGER REFERENCES fleet_service_providers(id),
  maintenance_id INTEGER REFERENCES fleet_maintenance(id),
  rating INTEGER CHECK(rating BETWEEN 1 AND 5),
  review_text TEXT,
  rated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 268: TSB (Technical Service Bulletin) tracking
CREATE TABLE IF NOT EXISTS fleet_tsbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tsb_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  manufacturer TEXT,
  applicable_makes TEXT,
  applicable_models TEXT,
  applicable_years TEXT,
  severity TEXT DEFAULT 'medium',
  issue_date TEXT,
  completed INTEGER DEFAULT 0,
  completed_date TEXT,
  completed_by INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 269: Warranty claims
CREATE TABLE IF NOT EXISTS fleet_warranty_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warranty_id INTEGER REFERENCES fleet_warranties(id),
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  claim_number TEXT,
  claim_date TEXT,
  description TEXT,
  amount REAL,
  approved INTEGER DEFAULT 0,
  approved_date TEXT,
  denial_reason TEXT,
  maintenance_id INTEGER REFERENCES fleet_maintenance(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 270: Service contracts
CREATE TABLE IF NOT EXISTS fleet_service_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  provider TEXT NOT NULL,
  contract_number TEXT,
  coverage_type TEXT,
  coverage_details TEXT,
  start_date TEXT,
  expiry_date TEXT,
  annual_cost REAL,
  deductible REAL,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 272: Parts-to-maintenance linking
CREATE TABLE IF NOT EXISTS fleet_maintenance_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maintenance_id INTEGER REFERENCES fleet_maintenance(id),
  part_id INTEGER REFERENCES fleet_parts(id),
  quantity INTEGER DEFAULT 1,
  unit_cost REAL,
  notes TEXT
);

-- Feature 277: Roadside assistance log
CREATE TABLE IF NOT EXISTS fleet_roadside_assistance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  incident_date TEXT,
  location TEXT,
  issue_type TEXT,
  provider TEXT,
  response_time_minutes INTEGER,
  resolution TEXT,
  cost REAL,
  driver_id INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 280: Maintenance bay scheduling
CREATE TABLE IF NOT EXISTS fleet_bay_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  bay_number TEXT,
  scheduled_start TEXT,
  scheduled_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  service_type TEXT,
  technician TEXT,
  status TEXT DEFAULT 'scheduled',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 281: Trade-in value estimates
CREATE TABLE IF NOT EXISTS fleet_trade_in_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  estimated_value REAL,
  source TEXT,
  valuation_date TEXT,
  condition_score INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 282: Vehicle disposal/auction
CREATE TABLE IF NOT EXISTS fleet_disposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  disposal_type TEXT CHECK(disposal_type IN ('auction','trade_in','sale','donation','scrap')),
  disposal_date TEXT,
  sale_price REAL,
  buyer TEXT,
  auction_house TEXT,
  lot_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 283: Lease management
CREATE TABLE IF NOT EXISTS fleet_leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  lessor TEXT,
  lease_number TEXT,
  start_date TEXT,
  end_date TEXT,
  monthly_payment REAL,
  residual_value REAL,
  mileage_allowance INTEGER,
  current_mileage INTEGER,
  excess_mileage_rate REAL,
  buyout_option INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 287: Vehicle condition scoring
CREATE TABLE IF NOT EXISTS fleet_condition_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  exterior_score INTEGER CHECK(exterior_score BETWEEN 1 AND 10),
  interior_score INTEGER CHECK(interior_score BETWEEN 1 AND 10),
  mechanical_score INTEGER CHECK(mechanical_score BETWEEN 1 AND 10),
  overall_score REAL,
  scored_by INTEGER REFERENCES users(id),
  scored_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 289: Purchase order tracking
CREATE TABLE IF NOT EXISTS fleet_purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number TEXT NOT NULL,
  vehicle_description TEXT,
  vendor TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price REAL,
  total_price REAL,
  order_date TEXT,
  expected_delivery TEXT,
  actual_delivery TEXT,
  status TEXT DEFAULT 'ordered',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 290: Vehicle delivery checklist
CREATE TABLE IF NOT EXISTS fleet_delivery_checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  purchase_order_id INTEGER REFERENCES fleet_purchase_orders(id),
  checklist_data TEXT DEFAULT '{}',
  inspected_by INTEGER REFERENCES users(id),
  inspection_date TEXT,
  passed INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 291: FMCSA compliance
CREATE TABLE IF NOT EXISTS fleet_fmcsa_compliance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  checklist_date TEXT,
  annual_inspection_due TEXT,
  annual_inspection_completed TEXT,
  eld_compliant INTEGER DEFAULT 0,
  ifta_registered INTEGER DEFAULT 0,
  hazmat_certified INTEGER DEFAULT 0,
  carrier_operating_authority TEXT,
  last_audit_date TEXT,
  next_audit_due TEXT,
  violations_count INTEGER DEFAULT 0,
  safety_rating TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 293: IFTA fuel tax data
CREATE TABLE IF NOT EXISTS fleet_ifta_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  quarter INTEGER,
  year INTEGER,
  state TEXT,
  total_miles REAL,
  total_gallons REAL,
  tax_paid REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 295: Safety recall completion
CREATE TABLE IF NOT EXISTS fleet_safety_recalls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recall_id INTEGER REFERENCES fleet_recalls(id),
  completed_by INTEGER REFERENCES users(id),
  completed_date TEXT,
  verification_method TEXT,
  documentation_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 298: Defect reporting
CREATE TABLE IF NOT EXISTS fleet_defect_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  reported_by INTEGER REFERENCES users(id),
  defect_type TEXT,
  description TEXT NOT NULL,
  severity TEXT DEFAULT 'medium',
  reported_date TEXT,
  resolved INTEGER DEFAULT 0,
  resolved_date TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 300: Safety equipment inventory
CREATE TABLE IF NOT EXISTS fleet_safety_equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  equipment_type TEXT CHECK(equipment_type IN ('first_aid','fire_extinguisher','flares','cones','vest','flashlight','blanket','other')),
  quantity INTEGER DEFAULT 1,
  last_inspected TEXT,
  next_inspection_due TEXT,
  expiration_date TEXT,
  status TEXT DEFAULT 'good',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 302: Weight/load compliance
CREATE TABLE IF NOT EXISTS fleet_load_compliance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  gvwr REAL,
  curb_weight REAL,
  max_payload REAL,
  last_weigh_date TEXT,
  weigh_station TEXT,
  measured_weight REAL,
  compliance_status TEXT DEFAULT 'compliant',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 306: Cost center allocation
CREATE TABLE IF NOT EXISTS fleet_cost_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  department TEXT,
  budget_annual REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_cost_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  cost_center_id INTEGER REFERENCES fleet_cost_centers(id),
  allocation_pct REAL DEFAULT 100,
  effective_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 308: Grant tracking
CREATE TABLE IF NOT EXISTS fleet_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_name TEXT NOT NULL,
  grantor TEXT,
  grant_number TEXT,
  amount REAL,
  award_date TEXT,
  expiration_date TEXT,
  purpose TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_grant_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id INTEGER REFERENCES fleet_grants(id),
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  amount_allocated REAL,
  allocation_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 309: Capital vs operating cost
CREATE TABLE IF NOT EXISTS fleet_capital_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  asset_class TEXT,
  capitalization_date TEXT,
  capitalized_cost REAL,
  useful_life_years INTEGER,
  depreciation_method TEXT,
  annual_depreciation REAL,
  net_book_value REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 319: Fleet asset register
CREATE TABLE IF NOT EXISTS fleet_asset_register (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id) UNIQUE,
  asset_tag TEXT UNIQUE,
  acquisition_date TEXT,
  acquisition_cost REAL,
  funding_source TEXT,
  custodian TEXT,
  physical_location TEXT,
  last_verified TEXT,
  verified_by INTEGER REFERENCES users(id),
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 321: Vehicle pool reservation
CREATE TABLE IF NOT EXISTS fleet_pool_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  reserved_by INTEGER REFERENCES users(id),
  reservation_start TEXT NOT NULL,
  reservation_end TEXT NOT NULL,
  purpose TEXT,
  destination TEXT,
  passengers INTEGER,
  status TEXT DEFAULT 'confirmed',
  checked_out TEXT,
  checked_in TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 323: Vehicle transfers
CREATE TABLE IF NOT EXISTS fleet_vehicle_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  from_location TEXT,
  to_location TEXT,
  from_unit_id INTEGER REFERENCES units(id),
  to_unit_id INTEGER REFERENCES units(id),
  transfer_date TEXT,
  reason TEXT,
  approved_by INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 333: Vehicle decals/markings
CREATE TABLE IF NOT EXISTS fleet_vehicle_decals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  decal_type TEXT,
  decal_number TEXT,
  location_on_vehicle TEXT,
  applied_date TEXT,
  removed_date TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 334: Equipment upfit tracking
CREATE TABLE IF NOT EXISTS fleet_upfits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  upfit_type TEXT,
  description TEXT,
  vendor TEXT,
  cost REAL,
  install_date TEXT,
  warranty_expiry TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 335: Vehicle detailing schedule
CREATE TABLE IF NOT EXISTS fleet_detailing_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  scheduled_date TEXT,
  completed_date TEXT,
  detail_type TEXT DEFAULT 'standard',
  vendor TEXT,
  cost REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Feature 345: Custom metrics
CREATE TABLE IF NOT EXISTS fleet_custom_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  metric_type TEXT CHECK(metric_type IN ('number','currency','percentage','duration','rating')),
  unit TEXT,
  description TEXT,
  target_value REAL,
  warning_threshold REAL,
  critical_threshold REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_custom_metric_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_id INTEGER REFERENCES fleet_custom_metrics(id),
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  value REAL,
  recorded_date TEXT,
  recorded_by INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
