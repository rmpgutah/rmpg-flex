-- Cleanup orphaned GPS breadcrumbs
-- 1. Detach breadcrumbs whose trip_id points to a deleted trip
-- 2. (Optional) delete breadcrumbs older than N days with no trip association

-- Step 1: Fix stale trip_id references (breadcrumbs pointing to deleted trips)
-- Safe to re-run: idempotent
UPDATE gps_breadcrumbs SET trip_id = NULL
WHERE unit_id = 1
  AND trip_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM unit_trips t WHERE t.id = trip_id);

-- Step 2: Report remaining counts
SELECT 'after_cleanup' AS step,
       CAST(COUNT(*) AS INTEGER) AS total,
       CAST(SUM(CASE WHEN trip_id IS NULL THEN 1 ELSE 0 END) AS INTEGER) AS no_trip,
       CAST(SUM(CASE WHEN trip_id IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS has_trip,
       CAST(COUNT(DISTINCT trip_id) AS INTEGER) AS unique_trips
FROM gps_breadcrumbs WHERE unit_id = 1;
