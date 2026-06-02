-- 0070_unincorporated_zone_sector_fixes.sql
--
-- Durable form of the 2026-06-02 live-D1 geography correction (PR #916), so a
-- future re-seed of dispatch_zones cannot silently regress it.
--
-- The geojson (authoritative, ray-cast by src/utils/geofence.ts) uses:
--   WSH = Wasatch Co. Unincorp.      WSG = Washington Co. Unincorp.
-- but dispatch_zones had drifted:
--   * zone WSH was filed under the WASHINGTON County sector (wrong) -> a Wasatch
--     GPS hit was labeled Washington County in the dispatch backfill.
--   * zone WSG had sector_id = NULL -> excluded from the /districts JOIN, so
--     Washington's unincorporated area rendered blank on the map.
--
-- Idempotent: pure UPDATEs that re-assert the correct values; re-running is a
-- no-op. Sector ids are resolved by name (not hardcoded) and the EXISTS guard
-- prevents nulling the FK if a sector is somehow absent. Geometry lives in R2
-- (beat.geojson), not D1, so no beat rows are touched here.

UPDATE dispatch_zones
SET sector_id = (SELECT id FROM dispatch_sectors WHERE sector_name = 'Wasatch County'),
    zone_name = 'Wasatch Unincorporated',
    zone_type = 'unincorporated',
    active = 1
WHERE zone_code = 'WSH'
  AND EXISTS (SELECT 1 FROM dispatch_sectors WHERE sector_name = 'Wasatch County');

UPDATE dispatch_zones
SET sector_id = (SELECT id FROM dispatch_sectors WHERE sector_name = 'Washington County'),
    zone_name = 'Washington Unincorporated',
    zone_type = 'unincorporated',
    active = 1
WHERE zone_code = 'WSG'
  AND EXISTS (SELECT 1 FROM dispatch_sectors WHERE sector_name = 'Washington County');
