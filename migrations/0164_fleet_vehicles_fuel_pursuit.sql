-- 0164: fleet_vehicles.fuel_level + pursuit_rated
--
-- src/routes/dispatch/units.ts (GET /dispatch/units) selects
-- fv.fuel_level and fv.pursuit_rated, but no migration ever added these
-- columns to fleet_vehicles — on live D1 the query failed with
-- "no such column: fv.fuel_level", 500ing the dispatch console's unit
-- board (2026-07-01 incident). fleetio ownership map also references both.
--
-- D1 has no IF NOT EXISTS for ADD COLUMN; re-apply fails harmlessly with
-- "duplicate column name" (deploy.yml migration step is continue-on-error).
ALTER TABLE fleet_vehicles ADD COLUMN fuel_level TEXT;
ALTER TABLE fleet_vehicles ADD COLUMN pursuit_rated INTEGER DEFAULT 0;
