-- 0288: Warrant schema hardening (D1-compatible rewrite)
-- Fixes from the 2026-09-13 audit:
--
-- Part 1 (CHECK constraint): REMOVED — D1 blocks PRAGMA writable_schema, and
-- the live DB (baseline schema) has no CHECK on warrants.status anyway.
-- App-level validation in warrantStatus.ts handles the 'quashed' status.
--
-- Part 2 (poller-sync columns): MOVED to a runtime reconciler in
-- src/routes/warrants.ts (reconcileWarrantsSchema) using the columnExists
-- pattern from db.ts. D1 does not support ADD COLUMN IF NOT EXISTS, and a
-- plain ADD COLUMN in a multi-statement migration aborts the whole file on
-- the first duplicate column name error.
--
-- Part 3 (indexes): Kept here — CREATE INDEX IF NOT EXISTS is D1-safe.

-- GET /unified filters archived_at IS NULL on every load.
CREATE INDEX IF NOT EXISTS idx_warrants_archived_at
  ON warrants(archived_at);

-- GET /person/:id/profile and unified both filter subject_person_id.
CREATE INDEX IF NOT EXISTS idx_warrants_subject_person_id
  ON warrants(subject_person_id);

-- Summary report and expiry queries filter/sort on issued_date.
CREATE INDEX IF NOT EXISTS idx_warrants_issued_date
  ON warrants(issued_date);

-- Compound index for the most common list query: status + archived + recency.
CREATE INDEX IF NOT EXISTS idx_warrants_status_archived_created
  ON warrants(status, archived_at, created_at DESC);
