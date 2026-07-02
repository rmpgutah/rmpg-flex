-- 0164: fleet_vehicles.fuel_level
--
-- src/routes/dispatch/units.ts (GET /dispatch/units) selects fv.fuel_level,
-- but no migration ever added it — live D1 500'd the dispatch unit board
-- ("no such column: fv.fuel_level", 2026-07-01 incident).
-- pursuit_rated lives in its own file (0166) so a duplicate-column failure
-- on one ALTER cannot abort the other on partially-migrated environments
-- (D1 has no IF NOT EXISTS for ADD COLUMN).
ALTER TABLE fleet_vehicles ADD COLUMN fuel_level TEXT;
