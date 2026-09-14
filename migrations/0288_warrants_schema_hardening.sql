-- 0288: Warrant schema hardening (indexes only)
--
-- Background from 2026-09-14 live D1 audit:
--   • status CHECK constraint ('quashed' missing from 0001 DDL) — live test
--     confirmed D1 does NOT enforce the original CHECK (table rebuilt via ALTER
--     TABLE chains that didn't carry it forward). PRAGMA writable_schema is also
--     blocked by D1. No DDL change needed.
--   • Poller-sync columns (subject_first_name, confirmed, last_checked_at, etc.)
--     — live pragma_table_info confirms ALL columns already present. D1 does not
--     support ALTER TABLE … ADD COLUMN IF NOT EXISTS, so no-op ALTERs are omitted.
--
-- What this migration DOES add: four performance indexes eliminated by the audit.
-- GET /unified filters archived_at IS NULL on every load (no index → full scan).
-- Person-profile and unified queries filter subject_person_id (no index).
-- Summary report and expiry queries filter/sort on issued_date (no index).
-- Most common list query: status + archived + recency (compound).

CREATE INDEX IF NOT EXISTS idx_warrants_archived_at
  ON warrants(archived_at);

CREATE INDEX IF NOT EXISTS idx_warrants_subject_person_id
  ON warrants(subject_person_id);

CREATE INDEX IF NOT EXISTS idx_warrants_issued_date
  ON warrants(issued_date);

CREATE INDEX IF NOT EXISTS idx_warrants_status_archived_created
  ON warrants(status, archived_at, created_at DESC);
