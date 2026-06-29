-- ============================================================
-- 0041_geography_create_columns.sql
-- ============================================================
-- The legacy rmpg-flex geography create handlers (POST
-- /api/dispatch/geography/{areas,sectors,zones}) INSERT columns that
-- drifted off the live tables, so creating any new Area/Sector/Zone
-- 500'd with `no such column`. Since the tiers are hierarchical
-- (area → sector → zone → beat), a broken area-create blocked building
-- new geography from the top.
--
-- Missing columns by tier (vs the deployed INSERT statements):
--   dispatch_areas   : commander, notes
--   dispatch_sectors : notes
--   dispatch_zones   : notes
--   dispatch_beats   : (complete — no change)
--
-- Added as nullable TEXT (existing rows → NULL). Already applied to live
-- D1 on 2026-05-29; this backports it to source. D1 has no IF NOT EXISTS
-- on ADD COLUMN, so re-apply errors on the ALTERs (deploy.yml
-- continue-on-error covers it).

ALTER TABLE dispatch_areas ADD COLUMN commander TEXT;
ALTER TABLE dispatch_areas ADD COLUMN notes TEXT;
ALTER TABLE dispatch_sectors ADD COLUMN notes TEXT;
ALTER TABLE dispatch_zones ADD COLUMN notes TEXT;
