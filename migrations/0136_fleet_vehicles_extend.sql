-- Fleet.io PR 3 — extend fleet_vehicles with 13 columns for Fleet.io parity
-- + autofill (ref-table FKs landed in PR 2).
-- Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md
-- Diff: docs/superpowers/specs/2026-06-21-fleetio-schema-diff.md
--
-- Pre-state on live D1 785de7ae: fleet_vehicles has 62 columns.
-- Post-state: 75 columns. Safely under the D1 ~100-column cap.
--
-- D1 does NOT support `IF NOT EXISTS` on `ALTER TABLE ADD COLUMN`, so a
-- re-apply will error on the already-present columns — that's expected
-- and the deploy step is continue-on-error. Apply DIRECTLY to live D1
-- 785de7ae after merge and verify with `pragma_table_info('fleet_vehicles')`.
-- This file is the repo record. (Same pattern as 0064_incident_subresource_columns.sql.)
--
-- All added columns are nullable / default-bearing so existing rows survive
-- the ALTER without backfill. FK columns reference ref tables created in
-- migration 0134 (PR 2). Soft FK (no SQLite FK constraint enforced; the
-- route layer validates).

-- ── Meter units (Fleet.io concept: primary + secondary meters) ──
ALTER TABLE fleet_vehicles ADD COLUMN fuel_volume_units TEXT;
ALTER TABLE fleet_vehicles ADD COLUMN primary_meter_unit TEXT;     -- 'mi' | 'km' (joins ref_units_of_measure.code)
ALTER TABLE fleet_vehicles ADD COLUMN secondary_meter_value INTEGER;
ALTER TABLE fleet_vehicles ADD COLUMN secondary_meter_unit TEXT;   -- 'hr' | 'mi' (e.g. engine hours alongside odometer)
ALTER TABLE fleet_vehicles ADD COLUMN secondary_meter_label TEXT;  -- free-text label ('Engine Hours')

-- ── Fleet operations metadata ──
ALTER TABLE fleet_vehicles ADD COLUMN watch_list INTEGER DEFAULT 0;     -- Fleet.io's "watch this vehicle" flag (boolean 0/1)
ALTER TABLE fleet_vehicles ADD COLUMN default_image_url TEXT;           -- optional avatar / hero photo

-- ── Spec / autofill FKs into PR 2 ref tables ──
-- All are soft FKs (no SQLite constraint) so a deleted ref row doesn't
-- cascade-fail a vehicle row; the route layer validates on write.
ALTER TABLE fleet_vehicles ADD COLUMN tire_size_id INTEGER;             -- FK -> ref_tire_sizes(id)
ALTER TABLE fleet_vehicles ADD COLUMN oil_type_id INTEGER;              -- FK -> ref_oil_types(id)
ALTER TABLE fleet_vehicles ADD COLUMN oil_capacity_qts REAL;
ALTER TABLE fleet_vehicles ADD COLUMN coolant_capacity_qts REAL;
ALTER TABLE fleet_vehicles ADD COLUMN gvwr_lbs INTEGER;
ALTER TABLE fleet_vehicles ADD COLUMN fuel_type_id INTEGER;             -- FK -> ref_fuel_types(id)

-- ── Indexes for the FK lookups we'll actually do at read time ──
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_fuel_type
  ON fleet_vehicles (fuel_type_id);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_oil_type
  ON fleet_vehicles (oil_type_id);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_tire_size
  ON fleet_vehicles (tire_size_id);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_watch_list
  ON fleet_vehicles (watch_list)
  WHERE watch_list = 1;
