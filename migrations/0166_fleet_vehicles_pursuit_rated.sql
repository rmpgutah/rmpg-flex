-- 0166: fleet_vehicles.pursuit_rated (split from 0164 — one ALTER per file
-- so a duplicate-column re-apply error on fuel_level cannot block this one).
-- Selected unconditionally by GET /dispatch/units.
ALTER TABLE fleet_vehicles ADD COLUMN pursuit_rated INTEGER DEFAULT 0;
