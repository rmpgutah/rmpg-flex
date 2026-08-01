-- ============================================================
-- 0221 — Merge Fleet.io "ghost" fuel rows into their native twins
-- ============================================================
-- Fleet.io `/pull` deduped only against `fleetio_links` ("did I import this
-- Fleet.io id before?") and never against pre-existing native RMPG rows, so
-- every fill an officer entered that ALSO existed in Fleet.io imported a
-- second time. The pulled row carries only vehicle_id + fuel_date + gallons
-- (+ sometimes cost) — no odometer, driver, station or payment method.
--
-- Live D1 785de7ae as of 2026-08-01: 22 such rows out of 113. Effects:
--   * 30-day gallons read 107.9 against a true 36.4 (~3x inflation), which
--     skewed fleet utilization, cost-per-mile and the fuel z-scores.
--   * They render in the vehicle Fuel tab as bare "10.991 gal" entries.
--
-- The forward fix is in src/routes/fleetio.ts (natural-key dedupe: a matching
-- native row is ADOPTED and enriched instead of duplicated). This migration
-- cleans up the rows that already landed.
--
-- ⚠️  WHY THIS RUNS AS SQL AND NOT VIA THE UI "Delete Duplicates" BUTTON:
--     DELETE /api/fleet/fuel/:id emits a Fleet.io outbound `fuel.delete`,
--     which resolves through fleetio_links and would DELETE THE ENTRY IN
--     FLEET.IO as well. The ghost holds the link, so deleting it through the
--     app destroys the upstream record. Operating directly on D1 bypasses the
--     Worker's emit path entirely — the Fleet.io side is left untouched.
--
-- Strategy per ghost/twin pair:
--   1. Backfill any column the native twin is missing from the ghost.
--   2. Re-point the ghost's fleetio_links row at the native twin, so the
--      Fleet.io entry stays linked to the surviving RMPG row (and a future
--      /pull still sees it as already-imported).
--   3. Delete the ghost row.
--
-- Idempotent: re-running matches nothing once the ghosts are gone.
-- ============================================================

-- A ghost is: same vehicle, same gallons (to 0.01), within 10 minutes of a
-- native row, itself carrying no odometer AND no driver, where the twin does
-- carry an odometer. Requiring the twin to have an odometer is what keeps
-- this from firing on two legitimately-sparse rows.
CREATE TEMP TABLE IF NOT EXISTS _ghost_pairs AS
SELECT
  g.id   AS ghost_id,
  t.id   AS twin_id
FROM fleet_fuel_log g
JOIN fleet_fuel_log t
  ON  t.vehicle_id = g.vehicle_id
  AND t.id <> g.id
  AND t.gallons IS NOT NULL
  AND g.gallons IS NOT NULL
  AND ABS(t.gallons - g.gallons) < 0.01
  AND ABS(julianday(t.fuel_date) - julianday(g.fuel_date)) * 1440 <= 10
  AND t.odometer IS NOT NULL
WHERE g.odometer IS NULL
  AND g.driver_name IS NULL
  -- Only rows Fleet.io actually created.
  AND EXISTS (
    SELECT 1 FROM fleetio_links fl
     WHERE fl.rmpg_table = 'fleet_fuel_log' AND fl.rmpg_id = g.id
  );

-- 1. Fill only what the twin is missing — an officer-entered value always wins.
UPDATE fleet_fuel_log
   SET total_cost = COALESCE(total_cost,
         (SELECT g.total_cost FROM fleet_fuel_log g
           JOIN _ghost_pairs p ON p.ghost_id = g.id
          WHERE p.twin_id = fleet_fuel_log.id)),
       cost_per_gallon = COALESCE(cost_per_gallon,
         (SELECT g.cost_per_gallon FROM fleet_fuel_log g
           JOIN _ghost_pairs p ON p.ghost_id = g.id
          WHERE p.twin_id = fleet_fuel_log.id))
 WHERE id IN (SELECT twin_id FROM _ghost_pairs);

-- 2. Re-point the Fleet.io link at the surviving native row. Done before the
--    delete so the link is never briefly orphaned. OR REPLACE covers the case
--    where the twin somehow already carries a link for the same resource.
UPDATE OR REPLACE fleetio_links
   SET rmpg_id = (SELECT p.twin_id FROM _ghost_pairs p WHERE p.ghost_id = fleetio_links.rmpg_id)
 WHERE rmpg_table = 'fleet_fuel_log'
   AND rmpg_id IN (SELECT ghost_id FROM _ghost_pairs);

-- 3. Drop the ghosts.
DELETE FROM fleet_fuel_log WHERE id IN (SELECT ghost_id FROM _ghost_pairs);

DROP TABLE IF EXISTS _ghost_pairs;
