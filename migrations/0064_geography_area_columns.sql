-- 0064: Full Area > Section > Zone > Beat geography on dispatch records.
--
-- Section (sector_*), Zone (zone_*), and Beat (beat_*) already live on
-- calls_for_service (base) + incidents. AREA was missing. resolveDistrict now
-- joins dispatch_areas and returns area_code/area_name; call + incident
-- creation backfill them from the geofence so every dispatch record captures
-- the complete A/S/Z/B hierarchy.
--
-- calls_for_service is at the D1 100-column cap, so Area overflows to the 1:1
-- calls_for_service_ext table (same pattern as PSO / tactical flags). incidents
-- is not capped, so it gets the columns directly.
--
-- D1 does not support IF NOT EXISTS on ADD COLUMN; re-applying tolerates the
-- "duplicate column" error (deploy.yml runs migrations with continue-on-error).
ALTER TABLE calls_for_service_ext ADD COLUMN area_code TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN area_name TEXT;
ALTER TABLE incidents ADD COLUMN area_code TEXT;
ALTER TABLE incidents ADD COLUMN area_name TEXT;
