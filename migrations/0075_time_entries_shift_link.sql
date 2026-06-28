-- 0075_time_entries_shift_link.sql
-- Links a time entry (clock-in/out) to the unit + fleet vehicle the officer
-- worked that shift, so "clock on / go on duty" becomes one integrated shift
-- record across time_entries ↔ units ↔ fleet_vehicles.
--
--   • unit_id    — the dispatch unit the officer was in-service on
--   • vehicle_id — the fleet vehicle assigned for the shift
--
-- ADDITIVE + NON-DESTRUCTIVE. time_entries has ~12 columns, nowhere near the
-- D1 ~100-column SELECT cap. D1 does NOT support IF NOT EXISTS on ADD COLUMN;
-- deploy.yml applies migrations with continue-on-error and the live DB is
-- ALTERed out-of-band the same way, so a re-apply that errors "duplicate
-- column" is harmless.

ALTER TABLE time_entries ADD COLUMN unit_id INTEGER;
ALTER TABLE time_entries ADD COLUMN vehicle_id INTEGER;
