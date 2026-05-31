-- 0057_fleet_schema_alignment.sql
-- ============================================================
-- Align live D1 fleet schema with src/routes/fleet.ts handlers.
--
-- Root problem (found 2026-05-31): the Fleet Manager rewrite handlers
-- INSERT/UPDATE columns and tables that never existed on live D1, so
-- every fleet write 500'd ("saves then vanishes"). Live had only 10
-- fleet tables, several missing the columns the handlers write. All
-- fleet tables were empty (1 vehicle, 0 everything else) at migration
-- time, so this expansion is non-destructive.
--
-- Generated from the exact INSERT/UPDATE column lists in
-- src/routes/fleet.ts, verified against live PRAGMA table_info.
-- D1 has no `IF NOT EXISTS` on ADD COLUMN; the ALTERs below target
-- columns confirmed absent on live. On re-apply they error harmlessly
-- (deploy.yml runs migrations with continue-on-error).
-- ============================================================

-- ── Column additions to existing tables ──
ALTER TABLE fleet_fuel_log ADD COLUMN total_cost REAL;
ALTER TABLE fleet_fuel_log ADD COLUMN notes TEXT;
ALTER TABLE fleet_maintenance ADD COLUMN type TEXT;
ALTER TABLE fleet_maintenance ADD COLUMN description TEXT;
ALTER TABLE fleet_maintenance ADD COLUMN mileage_at_service TEXT;
ALTER TABLE fleet_maintenance ADD COLUMN vendor TEXT;
ALTER TABLE fleet_maintenance ADD COLUMN performed_by TEXT;
ALTER TABLE fleet_maintenance ADD COLUMN performed_at TEXT;
ALTER TABLE fleet_maintenance ADD COLUMN next_due_date TEXT;
ALTER TABLE fleet_maintenance ADD COLUMN next_due_mileage INTEGER;
ALTER TABLE fleet_inspections ADD COLUMN overall_result TEXT;
ALTER TABLE fleet_inspections ADD COLUMN inspector_id INTEGER;
ALTER TABLE fleet_inspections ADD COLUMN mileage_at_inspection TEXT;
ALTER TABLE fleet_personnel_notes ADD COLUMN user_id INTEGER;
ALTER TABLE fleet_personnel_notes ADD COLUMN content TEXT;

-- ── New tables (CREATE IF NOT EXISTS — idempotent) ──
CREATE TABLE IF NOT EXISTS fleet_pretrip_checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  officer_id INTEGER,
  check_date TEXT,
  lights TEXT,
  brakes TEXT,
  radio TEXT,
  mdt TEXT,
  dashcam TEXT,
  tires TEXT,
  fluids TEXT,
  exterior TEXT,
  interior TEXT,
  emergency_equip TEXT,
  notes TEXT,
  status TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_tires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  tire_position TEXT,
  brand TEXT,
  model TEXT,
  size TEXT,
  dot_code TEXT,
  tread_depth REAL,
  pressure_psi REAL,
  installed_date TEXT,
  installed_mileage INTEGER,
  cost REAL,
  notes TEXT,
  removed_date TEXT,
  removed_mileage INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_damage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  damage_type TEXT,
  location TEXT,
  severity TEXT,
  description TEXT,
  reported_by TEXT,
  reported_date TEXT,
  repair_cost REAL,
  repair_status TEXT,
  repair_date TEXT,
  photo_urls TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_recalls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  nhtsa_number TEXT,
  description TEXT,
  severity TEXT,
  issue_date TEXT,
  remedy_date TEXT,
  status TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT,
  name TEXT,
  category TEXT,
  description TEXT,
  unit_cost REAL,
  quantity_on_hand INTEGER,
  reorder_point INTEGER,
  supplier TEXT,
  compatible_vehicles TEXT,
  location TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_warranties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  coverage_type TEXT,
  provider TEXT,
  policy_number TEXT,
  coverage_details TEXT,
  start_date TEXT,
  expiry_date TEXT,
  expiry_mileage INTEGER,
  deductible REAL,
  contact_info TEXT,
  status TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  key_number TEXT,
  key_type TEXT,
  rfid_tag TEXT,
  status TEXT,
  current_holder TEXT,
  last_checkout TEXT,
  last_return TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_key_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id INTEGER,
  action TEXT,
  holder_name TEXT,
  timestamp TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_accidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  accident_date TEXT,
  location TEXT,
  severity TEXT,
  description TEXT,
  driver_id INTEGER,
  weather_conditions TEXT,
  road_conditions TEXT,
  police_report_number TEXT,
  insurance_claim_number TEXT,
  estimated_damage TEXT,
  injuries TEXT,
  fault_determination TEXT,
  status TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_service_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  provider_type TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  contact_name TEXT,
  tax_id INTEGER,
  preferred INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_fuel_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_number TEXT,
  provider TEXT,
  assigned_vehicle_id INTEGER,
  pin TEXT,
  credit_limit REAL,
  status TEXT,
  expiration_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year TEXT,
  category TEXT,
  allocated_amount REAL,
  spent_amount REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_depreciation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  purchase_price REAL,
  salvage_value REAL,
  useful_life_months INTEGER,
  depreciation_method REAL,
  monthly_depreciation REAL,
  accumulated_depreciation REAL,
  current_book_value REAL,
  calculated_date TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_replacement_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  replacement_year TEXT,
  replacement_reason TEXT,
  estimated_replacement_cost REAL,
  priority TEXT,
  status TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_fuel_vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  location TEXT,
  brand TEXT,
  current_price_per_gallon REAL,
  last_updated TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_fuel_reconciliation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  period_start TEXT,
  period_end TEXT,
  card_total TEXT,
  manual_total TEXT,
  variance TEXT,
  notes TEXT,
  reconciled_by TEXT,
  reconciled_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_alt_fuel_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  fuel_type TEXT,
  charge_kwh REAL,
  gge_equivalent REAL,
  cost REAL,
  charge_start TEXT,
  charge_end TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_vendor_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_provider_id INTEGER,
  maintenance_id INTEGER,
  rating TEXT,
  review_text TEXT,
  rated_by REAL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_tsbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tsb_number TEXT,
  title TEXT,
  description TEXT,
  manufacturer TEXT,
  applicable_makes TEXT,
  applicable_models TEXT,
  applicable_years INTEGER,
  severity TEXT,
  issue_date TEXT,
  notes TEXT,
  completed INTEGER DEFAULT 0,
  completed_date TEXT,
  completed_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_warranty_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warranty_id INTEGER,
  vehicle_id INTEGER,
  claim_number TEXT,
  claim_date TEXT,
  description TEXT,
  amount REAL,
  maintenance_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_service_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  provider TEXT,
  contract_number TEXT,
  coverage_type TEXT,
  coverage_details TEXT,
  start_date TEXT,
  expiry_date TEXT,
  annual_cost REAL,
  deductible REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_maintenance_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maintenance_id INTEGER,
  part_id INTEGER,
  quantity INTEGER,
  unit_cost REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_roadside_assistance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  incident_date TEXT,
  location TEXT,
  issue_type TEXT,
  provider TEXT,
  response_time_minutes INTEGER,
  resolution TEXT,
  cost REAL,
  driver_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_bay_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  bay_number TEXT,
  scheduled_start TEXT,
  scheduled_end TEXT,
  service_type TEXT,
  technician TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_trade_in_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  estimated_value REAL,
  source TEXT,
  valuation_date TEXT,
  condition_score REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_disposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  disposal_type TEXT,
  disposal_date TEXT,
  sale_price REAL,
  buyer TEXT,
  auction_house TEXT,
  lot_number TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  lessor TEXT,
  lease_number TEXT,
  start_date TEXT,
  end_date TEXT,
  monthly_payment REAL,
  residual_value REAL,
  mileage_allowance REAL,
  current_mileage INTEGER,
  excess_mileage_rate INTEGER,
  buyout_option TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_condition_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  exterior_score REAL,
  interior_score REAL,
  mechanical_score REAL,
  overall_score REAL,
  scored_by REAL,
  scored_date REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number TEXT,
  vehicle_description TEXT,
  vendor TEXT,
  quantity INTEGER,
  unit_price REAL,
  total_price REAL,
  order_date TEXT,
  expected_delivery TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_delivery_checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  purchase_order_id INTEGER,
  checklist_data TEXT,
  inspected_by TEXT,
  inspection_date TEXT,
  passed INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_fmcsa_compliance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  checklist_date TEXT,
  annual_inspection_due TEXT,
  annual_inspection_completed INTEGER,
  eld_compliant INTEGER,
  ifta_registered INTEGER,
  hazmat_certified INTEGER,
  carrier_operating_authority TEXT,
  last_audit_date TEXT,
  next_audit_due TEXT,
  violations_count INTEGER,
  safety_rating TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_ifta_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  quarter TEXT,
  year TEXT,
  state TEXT,
  total_miles REAL,
  total_gallons REAL,
  tax_paid REAL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_safety_recalls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recall_id INTEGER,
  completed_by INTEGER,
  completed_date INTEGER,
  verification_method TEXT,
  documentation_url TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_defect_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  reported_by TEXT,
  defect_type TEXT,
  description TEXT,
  severity TEXT,
  reported_date TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_safety_equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  equipment_type TEXT,
  quantity INTEGER,
  last_inspected TEXT,
  next_inspection_due TEXT,
  expiration_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_load_compliance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  gvwr REAL,
  curb_weight REAL,
  max_payload REAL,
  last_weigh_date TEXT,
  weigh_station TEXT,
  measured_weight REAL,
  compliance_status TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_cost_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  code TEXT,
  department TEXT,
  budget_annual REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_cost_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  cost_center_id INTEGER,
  allocation_pct REAL,
  effective_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_name TEXT,
  grantor TEXT,
  grant_number TEXT,
  amount REAL,
  award_date TEXT,
  expiration_date TEXT,
  purpose TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_grant_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id INTEGER,
  vehicle_id INTEGER,
  amount_allocated REAL,
  allocation_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_capital_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  asset_class TEXT,
  capitalization_date TEXT,
  capitalized_cost REAL,
  useful_life_years INTEGER,
  depreciation_method REAL,
  annual_depreciation REAL,
  net_book_value REAL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_asset_register (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  asset_tag TEXT,
  acquisition_date TEXT,
  acquisition_cost REAL,
  funding_source TEXT,
  custodian TEXT,
  physical_location TEXT,
  last_verified TEXT,
  verified_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_pool_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  reserved_by TEXT,
  reservation_start TEXT,
  reservation_end TEXT,
  purpose TEXT,
  destination TEXT,
  passengers INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_vehicle_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  from_location TEXT,
  to_location TEXT,
  from_unit_id INTEGER,
  to_unit_id INTEGER,
  transfer_date TEXT,
  reason TEXT,
  approved_by TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_vehicle_decals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  decal_type TEXT,
  decal_number TEXT,
  location_on_vehicle TEXT,
  applied_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_upfits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  upfit_type TEXT,
  description TEXT,
  vendor TEXT,
  cost REAL,
  install_date TEXT,
  warranty_expiry TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_detailing_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  scheduled_date TEXT,
  detail_type TEXT,
  vendor TEXT,
  cost REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_custom_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  metric_type TEXT,
  unit TEXT,
  description TEXT,
  target_value REAL,
  warning_threshold TEXT,
  critical_threshold TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_custom_metric_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_id INTEGER,
  vehicle_id INTEGER,
  value REAL,
  recorded_date TEXT,
  recorded_by TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_driver_certs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  cert_type TEXT,
  cert_number TEXT,
  issuer TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_driver_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  vehicle_id INTEGER,
  incident_type TEXT,
  incident_date TEXT,
  description TEXT,
  severity TEXT,
  action_taken TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_driver_vehicle_training (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  vehicle_id INTEGER,
  training_type TEXT,
  trained_date TEXT,
  trainer_id INTEGER,
  expiry_date TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_driver_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  vehicle_id INTEGER,
  rating TEXT,
  feedback_text TEXT,
  category TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_equipment_calibrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_type TEXT,
  equipment_id INTEGER,
  vehicle_id INTEGER,
  last_calibrated REAL,
  next_calibration_due TEXT,
  calibration_standard TEXT,
  passed INTEGER,
  technician TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_vehicle_theft (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  theft_date TEXT,
  location TEXT,
  police_report_number TEXT,
  insurance_claim_number TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_vehicle_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  vehicle_type TEXT,
  make TEXT,
  model TEXT,
  base_cost REAL,
  equipment_package TEXT,
  ordering_code TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_procurement_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_id INTEGER,
  order_number TEXT,
  vendor TEXT,
  quantity INTEGER,
  unit_price REAL,
  total_price REAL,
  order_date TEXT,
  expected_delivery TEXT,
  approved_by TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_vendor_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procurement_order_id INTEGER,
  vendor TEXT,
  bid_amount REAL,
  delivery_days INTEGER,
  warranty_details TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_decommissioning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  decommission_date TEXT,
  reason TEXT,
  completed_by INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_accessories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  name TEXT,
  category TEXT,
  installed_date TEXT,
  removed_date TEXT,
  cost REAL,
  vendor TEXT,
  warranty_expiry TEXT,
  serial_number TEXT,
  status TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_fuel_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  fuel_log_id INTEGER,
  anomaly_type TEXT,
  detected_date TEXT,
  severity TEXT,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fleet_fuel_efficiency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  vehicle_number TEXT,
  period_start TEXT,
  period_end TEXT,
  total_gallons REAL,
  total_miles REAL,
  mpg REAL,
  cost_per_mile REAL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
