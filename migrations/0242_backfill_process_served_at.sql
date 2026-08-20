-- Backfill process_served_at on calls_for_service_ext for all linked
-- served/failed serve_queue jobs where the field is currently null.
-- Uses closed_at from the serve_queue row (stamped write-once at completion),
-- falling back to updated_at. The forward path (reversePsoSync.ts) now uses
-- the same priority order, so new completions are covered going forward.
UPDATE calls_for_service_ext
SET process_served_at = (
  SELECT COALESCE(sq.closed_at, sq.updated_at)
  FROM serve_queue sq
  WHERE sq.call_id = calls_for_service_ext.id
    AND sq.status IN ('served', 'failed')
    AND (sq.closed_at IS NOT NULL OR sq.updated_at IS NOT NULL)
  ORDER BY sq.id DESC
  LIMIT 1
)
WHERE process_served_at IS NULL
  AND EXISTS (
    SELECT 1 FROM serve_queue sq
    WHERE sq.call_id = calls_for_service_ext.id
      AND sq.status IN ('served', 'failed')
  );
