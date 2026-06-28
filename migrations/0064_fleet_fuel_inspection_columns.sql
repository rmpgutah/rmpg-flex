-- 0064_fleet_fuel_inspection_columns.sql
-- The fleet_fuel_log handler (POST /:id/fuel at src/routes/fleet.ts:772) writes
-- 14 columns, but the initial D1 CREATE TABLE (0052) had only 8 plus the
-- retroactive mpg column (0060). The handler references cost_per_gallon,
-- fuel_type, station, is_full_tank, payment_method, driver_name, and location
-- which were never part of any migration — causing INSERT to fail with
-- "no such column" when any of these fields is present in the body.
--
-- Similarly, fleet_inspections was missing the TEXT `inspector` column — the
-- handler writes an operator-typed name to `inspector` while `inspector_id`
-- stores the FK to users.id. inspector_id was in the original CREATE TABLE
-- and 0057, but the TEXT column was never migrated.
--
-- Applied directly to live D1 (785de7ae) on 2026-06-04.
-- D1 has no ADD COLUMN IF NOT EXISTS; re-apply errors harmlessly per column.
ALTER TABLE fleet_fuel_log ADD COLUMN cost_per_gallon REAL;
ALTER TABLE fleet_fuel_log ADD COLUMN fuel_type TEXT;
ALTER TABLE fleet_fuel_log ADD COLUMN station TEXT;
ALTER TABLE fleet_fuel_log ADD COLUMN is_full_tank INTEGER NOT NULL DEFAULT 1;
ALTER TABLE fleet_fuel_log ADD COLUMN payment_method TEXT;
ALTER TABLE fleet_fuel_log ADD COLUMN driver_name TEXT;
ALTER TABLE fleet_fuel_log ADD COLUMN location TEXT;
ALTER TABLE fleet_inspections ADD COLUMN inspector TEXT;
