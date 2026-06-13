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

-- Dedup before the UNIQUE index so creation can't fail on pre-existing dups
-- (idempotent: keeps the highest id per (source_key, warrant_id)).
DELETE FROM scraped_warrants
 WHERE id NOT IN (SELECT MAX(id) FROM scraped_warrants GROUP BY source_key, warrant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scraped_warrants_source_wid
  ON scraped_warrants(source_key, warrant_id);

-- Re-enable Baton Rouge (disabled inline in 0107 for the per-hit budget reason).
UPDATE national_warrant_sources SET enabled = 1 WHERE source_key = 'socrata-brla-citycourt';
