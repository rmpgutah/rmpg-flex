-- migrations/0222_assessor_full_cama_build.sql
-- ⚠️ RENUMBERED 0221 → 0222: 0221 was taken by 0221_fleetio_fuel_ghost_merge.sql
-- (PR #3230), which merged to main while this branch was open.
--
-- This file was ALREADY APPLIED to live D1 785de7ae on 2026-08-01 under its
-- old name, and d1_migrations holds a row for '0221_assessor_full_cama_build.sql'.
-- Under the new name it is untracked, so wrangler will run it once more. That
-- is harmless — every statement is CREATE TABLE IF NOT EXISTS or an ADD COLUMN
-- that raises "duplicate column name" on an already-present column, and the
-- deploy step is continue-on-error. No data is touched.
--
-- Full Salt Lake County CAMA column build. Generated from
-- src/utils/sl-assessor/camaFields.ts (146 fields) against the live
-- PubMore/detail.cfm rendering captured 2026-08-01 for 16-31-127-029-0000.
--
-- D1 does NOT support IF NOT EXISTS on ADD COLUMN. Re-applying this file
-- raises "duplicate column name" per statement, which is expected and
-- harmless — the Worker boot reconciler (src/utils/db.ts) is the
-- authoritative path and checks columnExists() before each ALTER.

-- Residence Record (1:1). Its own table because parcel_records already
-- carries 46 columns and D1 caps a SELECT at ~100 (CLAUDE.md rule #19).
CREATE TABLE IF NOT EXISTS parcel_residence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parcel_record_id INTEGER NOT NULL UNIQUE,
  building_style TEXT,
  assessment_classification TEXT,
  exterior_wall_type TEXT,
  roofing TEXT,
  central_ac TEXT,
  heating TEXT,
  foundation TEXT,
  msnry_trim TEXT,
  owner_occupied TEXT,
  number_of_stories REAL,
  total_rooms INTEGER,
  bedrooms INTEGER,
  full_baths INTEGER,
  three_quarter_baths INTEGER,
  half_baths INTEGER,
  number_of_kitchens INTEGER,
  finished_fire_places INTEGER,
  unfinished_fire_places INTEGER,
  year_built INTEGER,
  effective_year_built INTEGER,
  interior_grade TEXT,
  interior_condition TEXT,
  exterior_grade TEXT,
  exterior_condition TEXT,
  overall_grade TEXT,
  overall_condition TEXT,
  visual_appeal TEXT,
  maintenance TEXT,
  conformity TEXT,
  livability TEXT,
  primary_kitchen_quality TEXT,
  primary_bath_quality TEXT,
  main_floor_area INTEGER,
  upper_floor_area INTEGER,
  finished_attic_area INTEGER,
  above_grade_area INTEGER,
  basement_area INTEGER,
  finished_basement_area INTEGER,
  finished_basement_grade TEXT,
  carport_sqft INTEGER,
  carport_capacity INTEGER,
  attached_garage_sqft INTEGER,
  builtin_garage_sqft INTEGER,
  basement_garage_sqft INTEGER,
  unfinished_area INTEGER,
  rcn INTEGER,
  rcnld INTEGER,
  physical_prcnt_good REAL,
  economic_prcnt_good REAL,
  functional_prcnt_good REAL,
  sound_value INTEGER,
  misc_structure_value INTEGER,
  misc_attached_structure TEXT,
  percent_complete INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parcel_record_id) REFERENCES parcel_records(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_parcel_residence_record ON parcel_residence(parcel_record_id);
CREATE INDEX IF NOT EXISTS idx_parcel_residence_yearbuilt ON parcel_residence(year_built);
CREATE INDEX IF NOT EXISTS idx_parcel_residence_beds ON parcel_residence(bedrooms);

-- Parcel Record + Valuation blocks widen parcel_records.
-- ⚠️ COLUMN BUDGET: 47 existing + 42 + 6 = 95 (VERIFIED on live D1
-- 785de7ae, 2026-08-01, via pragma_table_info). Only 5 columns of headroom.
-- D1's SELECT cap is ~100. Do NOT add further columns here without
-- moving a block out, and never SELECT * from parcel_records.
ALTER TABLE parcel_records ADD COLUMN par_total_acreage REAL;
ALTER TABLE parcel_records ADD COLUMN par_eco_unit_acres REAL;
ALTER TABLE parcel_records ADD COLUMN par_owner_occupied TEXT;
ALTER TABLE parcel_records ADD COLUMN par_site_name TEXT;
ALTER TABLE parcel_records ADD COLUMN par_building_permit TEXT;
ALTER TABLE parcel_records ADD COLUMN par_tax_class_id TEXT;
ALTER TABLE parcel_records ADD COLUMN par_property_type TEXT;
ALTER TABLE parcel_records ADD COLUMN par_tax_district TEXT;
ALTER TABLE parcel_records ADD COLUMN par_tax_district_location TEXT;
ALTER TABLE parcel_records ADD COLUMN par_pct_exempt REAL;
ALTER TABLE parcel_records ADD COLUMN par_exempt_type TEXT;
ALTER TABLE parcel_records ADD COLUMN par_b_of_e TEXT;
ALTER TABLE parcel_records ADD COLUMN par_residential_exemption TEXT;
ALTER TABLE parcel_records ADD COLUMN par_detail_year INTEGER;
ALTER TABLE parcel_records ADD COLUMN par_new_growth_year INTEGER;
ALTER TABLE parcel_records ADD COLUMN par_new_growth_pct REAL;
ALTER TABLE parcel_records ADD COLUMN par_new_growth_amount INTEGER;
ALTER TABLE parcel_records ADD COLUMN par_update_year INTEGER;
ALTER TABLE parcel_records ADD COLUMN par_reinspection TEXT;
ALTER TABLE parcel_records ADD COLUMN par_total_associated TEXT;
ALTER TABLE parcel_records ADD COLUMN par_mls_number TEXT;
ALTER TABLE parcel_records ADD COLUMN val_land_value INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_building_value INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_final_value INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_taxable_value INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_cost_land INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_rcn INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_rcnld INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_cost_total INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_cost_date TEXT;
ALTER TABLE parcel_records ADD COLUMN val_additional_land_val INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_additional_bldg_val INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_inc_calc_by TEXT;
ALTER TABLE parcel_records ADD COLUMN val_comp_est INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_comp_sel_date TEXT;
ALTER TABLE parcel_records ADD COLUMN val_sel_land_val INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_sel_bldg_val INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_sel_val INTEGER;
ALTER TABLE parcel_records ADD COLUMN val_sel_source TEXT;
ALTER TABLE parcel_records ADD COLUMN val_bldg_factor REAL;
ALTER TABLE parcel_records ADD COLUMN val_tax_rate TEXT;
ALTER TABLE parcel_records ADD COLUMN val_economic_tot_val INTEGER;
ALTER TABLE parcel_records ADD COLUMN latitude REAL;
ALTER TABLE parcel_records ADD COLUMN longitude REAL;
ALTER TABLE parcel_records ADD COLUMN land_records_json TEXT;
ALTER TABLE parcel_records ADD COLUMN value_history_json TEXT;
ALTER TABLE parcel_records ADD COLUMN cama_as_of TEXT;
ALTER TABLE parcel_records ADD COLUMN cama_source_variant TEXT;

CREATE INDEX IF NOT EXISTS idx_parcel_records_proptype ON parcel_records(par_property_type);
CREATE INDEX IF NOT EXISTS idx_parcel_records_taxdistrict ON parcel_records(par_tax_district);
CREATE INDEX IF NOT EXISTS idx_parcel_records_latlon ON parcel_records(latitude, longitude);

-- Curated promotion onto the operational record cards.
ALTER TABLE businesses ADD COLUMN assessor_bedrooms INTEGER;
ALTER TABLE businesses ADD COLUMN assessor_full_baths INTEGER;
ALTER TABLE businesses ADD COLUMN assessor_stories REAL;
ALTER TABLE businesses ADD COLUMN assessor_above_grade_sqft INTEGER;
ALTER TABLE businesses ADD COLUMN assessor_basement_sqft INTEGER;
ALTER TABLE businesses ADD COLUMN assessor_garage_sqft INTEGER;
ALTER TABLE businesses ADD COLUMN assessor_property_type TEXT;
ALTER TABLE businesses ADD COLUMN assessor_zone TEXT;
ALTER TABLE businesses ADD COLUMN assessor_latitude REAL;
ALTER TABLE businesses ADD COLUMN assessor_longitude REAL;
ALTER TABLE properties ADD COLUMN assessor_bedrooms INTEGER;
ALTER TABLE properties ADD COLUMN assessor_full_baths INTEGER;
ALTER TABLE properties ADD COLUMN assessor_stories REAL;
ALTER TABLE properties ADD COLUMN assessor_above_grade_sqft INTEGER;
ALTER TABLE properties ADD COLUMN assessor_basement_sqft INTEGER;
ALTER TABLE properties ADD COLUMN assessor_garage_sqft INTEGER;
ALTER TABLE properties ADD COLUMN assessor_property_type TEXT;
ALTER TABLE properties ADD COLUMN assessor_zone TEXT;
ALTER TABLE properties ADD COLUMN assessor_latitude REAL;
ALTER TABLE properties ADD COLUMN assessor_longitude REAL;
