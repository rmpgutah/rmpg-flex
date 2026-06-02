-- 0064_warrants_served_location.sql
-- The warrant Serve modal captures a "Location Served" value and the warrant
-- detail panel + record PDF both render served_location — but the column never
-- existed on the live `warrants` table, so the typed location was silently
-- dropped on serve and the display/PDF field was always blank. Add the column
-- so the existing client UI works end-to-end.
-- Applied directly to live D1 (785de7ae) on 2026-06-02.
ALTER TABLE warrants ADD COLUMN served_location TEXT;
