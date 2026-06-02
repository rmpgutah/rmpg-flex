-- 0065_units_gps_heading_speed.sql
-- The map draws a heading-aligned "nav cursor" arrow and a speed label for each
-- unit (MapPage buildUnitMarkerContent reads unit.gps_heading / unit.gps_speed),
-- and gps.ts already RECEIVES heading + speed in the breadcrumb POST body — but
-- the live `units` table had no columns to mirror them onto, so the arrow never
-- rotated and the speed label was always blank. Add the columns; gps.ts now
-- writes the latest fix's heading/speed onto the unit row.
-- units is 17 cols (well under the 100-col D1 cap) — additive ALTERs are safe.
-- D1 has no IF NOT EXISTS on ADD COLUMN; re-apply failures are expected/ignored.
-- Applied directly to live D1 (785de7ae) on 2026-06-02.
ALTER TABLE units ADD COLUMN gps_heading REAL;
ALTER TABLE units ADD COLUMN gps_speed REAL;
