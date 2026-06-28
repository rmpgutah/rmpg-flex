-- Fleet.io PR 3 — extend fleet_fuel_log with 8 columns for Fleet.io parity
-- + ref-vendor FK + receipt photo + arbitrary-key custom fields.
-- Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md
-- Diff: docs/superpowers/specs/2026-06-21-fleetio-schema-diff.md
--
-- Pre-state on live D1 785de7ae: fleet_fuel_log has 17 columns.
-- Post-state: 25 columns. Far under the D1 ~100-column cap.
--
-- D1 does NOT support `IF NOT EXISTS` on `ALTER TABLE ADD COLUMN`, so a
-- re-apply will error on the already-present columns — that's expected
-- and the deploy step is continue-on-error. Apply DIRECTLY to live D1
-- 785de7ae after merge and verify with `pragma_table_info('fleet_fuel_log')`.
-- This file is the repo record. (Same pattern as 0064 / 0136.)

-- ── Fleet.io concepts the existing table didn't carry ──
ALTER TABLE fleet_fuel_log ADD COLUMN is_partial_fillup INTEGER DEFAULT 0;  -- boolean — full vs splash
ALTER TABLE fleet_fuel_log ADD COLUMN vendor_id INTEGER;                    -- soft FK -> ref_vendors(id) (kind='fuel')
ALTER TABLE fleet_fuel_log ADD COLUMN reference_number TEXT;                -- fuel-card receipt / Fleet.io reference

-- ── Geo capture (operator stamps lat/lng from device on entry) ──
ALTER TABLE fleet_fuel_log ADD COLUMN geo_lat REAL;
ALTER TABLE fleet_fuel_log ADD COLUMN geo_lng REAL;

-- ── Receipt photo (R2 key — file lives under UPLOADS bucket) ──
ALTER TABLE fleet_fuel_log ADD COLUMN receipt_r2_key TEXT;

-- ── Free-text + serialized customs ──
ALTER TABLE fleet_fuel_log ADD COLUMN comments TEXT;
ALTER TABLE fleet_fuel_log ADD COLUMN custom_fields_json TEXT;             -- per Fleet.io custom-field engine (deferred; we store payload)

-- ── Indexes for the FK + the geo lookup we'll actually do ──
CREATE INDEX IF NOT EXISTS idx_fleet_fuel_log_vendor
  ON fleet_fuel_log (vendor_id);
CREATE INDEX IF NOT EXISTS idx_fleet_fuel_log_geo
  ON fleet_fuel_log (geo_lat, geo_lng);
