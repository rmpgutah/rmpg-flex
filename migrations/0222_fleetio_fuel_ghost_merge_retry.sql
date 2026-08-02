-- ============================================================
-- 0222 — Merge Fleet.io duplicate fuel rows (retry of 0221)
-- ============================================================
-- ⚠️ 0221_fleetio_fuel_ghost_merge.sql IS TRACKED AS APPLIED BUT DID NOTHING.
--
-- It opened with `CREATE TEMP TABLE _ghost_pairs AS SELECT ...`. D1 does not
-- permit TEMP tables at all — the statement fails with
-- `not authorized: SQLITE_AUTH` (verified against live 2026-08-01). Because
-- the deploy step is `continue-on-error` and the tracker row is inserted
-- regardless, 0221 was recorded in `d1_migrations` while leaving all 22
-- duplicate rows in place. A tracked migration is NOT evidence that it ran —
-- always verify the data. 0221 cannot be edited and re-run: wrangler skips
-- any filename already in `d1_migrations`, hence a new number.
--
-- TWO D1 CONSTRAINTS SHAPE THIS FILE:
--   1. No TEMP tables (see above).
--   2. Inside a subquery whose FROM aliases the same table (`FROM
--      fleet_fuel_log g`), the bare name `fleet_fuel_log` NO LONGER RESOLVES
--      to the outer UPDATE target — it errors with `no such column:
--      fleet_fuel_log.fuel_date`. A first retry using correlated subqueries
--      failed on exactly this. Both writes below therefore use
--      `UPDATE <table> AS <alias> ... FROM (<pair set>)`, so the two scopes
--      never share a name, and the DELETE uses `id IN (...)` rather than a
--      correlated EXISTS.
--
-- Background: Fleet.io `/pull` deduped only against `fleetio_links` ("did I
-- import this Fleet.io id before?") and never against pre-existing native RMPG
-- rows, so every fill an officer entered that ALSO existed in Fleet.io
-- imported a second time, carrying only vehicle_id + fuel_date + gallons.
-- 22 such rows on live inflated 30-day gallons from a true 36.4 to 107.9
-- (~3x). The forward fix (natural-key dedupe in /pull) shipped in PR #3229.
--
-- Dry-run against live D1 785de7ae (2026-08-01): 16 duplicates / 16 twins, a
-- clean 1:1 match. The other 6 sparse rows are legitimate Fleet.io-only fills
-- with no counterpart and are deliberately left alone.
--
-- Idempotent: once the duplicates are gone, every predicate matches nothing.
-- ============================================================

-- ── 1. Backfill the surviving native row from its duplicate ──
-- COALESCE only, so an officer-entered value is never overwritten.
UPDATE fleet_fuel_log AS t
   SET total_cost      = COALESCE(t.total_cost, p.g_total_cost),
       cost_per_gallon = COALESCE(t.cost_per_gallon, p.g_cost_per_gallon)
  FROM (
    SELECT g.id AS ghost_id, tw.id AS twin_id,
           g.total_cost AS g_total_cost, g.cost_per_gallon AS g_cost_per_gallon
      FROM fleet_fuel_log g
      JOIN fleet_fuel_log tw
        ON tw.vehicle_id = g.vehicle_id
       AND tw.id <> g.id
       AND tw.odometer IS NOT NULL
       AND tw.gallons IS NOT NULL AND g.gallons IS NOT NULL
       AND ABS(tw.gallons - g.gallons) < 0.01
       AND ABS(julianday(tw.fuel_date) - julianday(g.fuel_date)) * 1440 <= 10
     WHERE g.odometer IS NULL
       AND g.driver_name IS NULL
       AND EXISTS (SELECT 1 FROM fleetio_links fl
                    WHERE fl.rmpg_table = 'fleet_fuel_log' AND fl.rmpg_id = g.id)
  ) AS p
 WHERE t.id = p.twin_id;

-- ── 2. Re-point the Fleet.io link at the surviving native row ──
-- Runs BEFORE the delete so the link is never briefly orphaned. This is also
-- what makes step 3's "no longer linked" test select exactly these rows.
UPDATE OR REPLACE fleetio_links AS fl
   SET rmpg_id = p.twin_id
  FROM (
    SELECT g.id AS ghost_id, tw.id AS twin_id
      FROM fleet_fuel_log g
      JOIN fleet_fuel_log tw
        ON tw.vehicle_id = g.vehicle_id
       AND tw.id <> g.id
       AND tw.odometer IS NOT NULL
       AND tw.gallons IS NOT NULL AND g.gallons IS NOT NULL
       AND ABS(tw.gallons - g.gallons) < 0.01
       AND ABS(julianday(tw.fuel_date) - julianday(g.fuel_date)) * 1440 <= 10
     WHERE g.odometer IS NULL
       AND g.driver_name IS NULL
       AND EXISTS (SELECT 1 FROM fleetio_links fl2
                    WHERE fl2.rmpg_table = 'fleet_fuel_log' AND fl2.rmpg_id = g.id)
  ) AS p
 WHERE fl.rmpg_table = 'fleet_fuel_log'
   AND fl.rmpg_id = p.ghost_id;

-- ── 3. Delete the duplicates ──
-- Duplicate-shaped, has a populated twin, and NO LONGER carries a Fleet.io
-- link (step 2 moved it). Verified against live before writing: ZERO rows
-- matched this shape beforehand, so it cannot catch anything pre-existing.
-- The 4 legitimate Fleet.io-only sparse rows are excluded by the twin test.
DELETE FROM fleet_fuel_log
 WHERE id IN (
   SELECT g.id
     FROM fleet_fuel_log g
     JOIN fleet_fuel_log tw
       ON tw.vehicle_id = g.vehicle_id
      AND tw.id <> g.id
      AND tw.odometer IS NOT NULL
      AND tw.gallons IS NOT NULL AND g.gallons IS NOT NULL
      AND ABS(tw.gallons - g.gallons) < 0.01
      AND ABS(julianday(tw.fuel_date) - julianday(g.fuel_date)) * 1440 <= 10
    WHERE g.odometer IS NULL
      AND g.driver_name IS NULL
      AND NOT EXISTS (SELECT 1 FROM fleetio_links fl
                       WHERE fl.rmpg_table = 'fleet_fuel_log' AND fl.rmpg_id = g.id)
 );
