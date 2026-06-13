-- 0110: chunked ingestion for large full-list warrant sources.
-- Adds per-source pagination progress, a UNIQUE index enabling batched upserts,
-- and re-enables Baton Rouge (~113K) now that chunking keeps it budget-safe.
-- ⚠️ Apply directly to live D1 (785de7ae) after merge (deploy step is continue-on-error).

CREATE TABLE IF NOT EXISTS national_warrant_source_progress (
  source_key         TEXT PRIMARY KEY,
  cursor             TEXT,                        -- opaque resume token; NULL = start of a fresh pass
  cycle_started_at   TEXT,                        -- ISO ts when the current full pass began
  last_full_cycle_at TEXT,                        -- ISO ts of the last completed pass (observability)
  rows_this_cycle    INTEGER NOT NULL DEFAULT 0,  -- running count for logging
  updated_at         TEXT DEFAULT (datetime('now'))
);

-- A UNIQUE index on (source_key, warrant_id) already exists from 0067 / baseline
-- (idx_scraped_warrants_src_wid). Keep a defensive IF NOT EXISTS under the SAME
-- name so it's a no-op on live but still a safety-net if 0067 silently never
-- landed (deploy migration step is continue-on-error). Dedup FIRST so the index
-- can't fail on pre-existing dups. NULL-safe: warrant_id is nullable, and a NULL
-- anywhere in a NOT IN subquery poisons the whole predicate (deletes nothing),
-- so exclude NULL-keyed rows from both sides.
DELETE FROM scraped_warrants
 WHERE source_key IS NOT NULL AND warrant_id IS NOT NULL
   AND id NOT IN (
     SELECT MAX(id) FROM scraped_warrants
      WHERE source_key IS NOT NULL AND warrant_id IS NOT NULL
      GROUP BY source_key, warrant_id
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_scraped_warrants_src_wid
  ON scraped_warrants(source_key, warrant_id);

-- Re-enable Baton Rouge (disabled inline in 0107 for the per-hit budget reason).
UPDATE national_warrant_sources SET enabled = 1 WHERE source_key = 'socrata-brla-citycourt';
