-- 0288: Warrant schema hardening
-- Fixes three classes of silent failures discovered in the 2026-09-13 audit:
--   1. 'quashed' missing from the warrants.status CHECK constraint — any PUT/:id
--      or POST/:id/reopen setting status='quashed' throws CHECK constraint failed
--      on D1, making the quashed branch completely broken.
--   2. Missing poller-sync columns — syncLocalWarrantRecord writes columns that
--      were never formally added via numbered migrations; a fresh D1 from
--      numbered migrations only would fail every poller write silently.
--   3. Missing indexes on high-filter columns (archived_at, subject_person_id,
--      issued_date) causing full scans on every list/unified query.

-- ── Part 1: Fix status CHECK ──────────────────────────────────────────────
-- SQLite stores CHECK constraints inside the CREATE TABLE SQL text in
-- sqlite_master. PRAGMA writable_schema patches that text without touching
-- table data. The guard clauses ensure idempotency and safe no-ops:
--   - WHERE … NOT LIKE '%''quashed''%'  → skip if already patched
--   - AND sql LIKE '%''recalled''%'     → skip if the original string changed
-- If writable_schema is unsupported (silently ignored by D1), 0 rows are
-- updated — the code path around it still gets hardened by the other parts.
PRAGMA writable_schema = ON;

UPDATE sqlite_master
  SET sql = REPLACE(
    sql,
    '''active'',''served'',''expired'',''cancelled'',''recalled'')',
    '''active'',''served'',''expired'',''cancelled'',''recalled'',''quashed'')'
  )
WHERE type = 'table'
  AND name = 'warrants'
  AND sql LIKE '%''recalled''%'
  AND sql NOT LIKE '%''quashed''%';

PRAGMA writable_schema = OFF;

-- ── Part 2: Poller-sync columns ───────────────────────────────────────────
-- These are written by syncLocalWarrantRecord in utahWarrantPoller.ts but
-- were never added by a numbered migration. D1's ALTER TABLE ignores
-- "duplicate column name" errors with continue-on-error, but in the poller
-- context they throw and are silently caught — so any newly-promoted warrant
-- loses all state-sync metadata.
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS subject_first_name TEXT;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS subject_last_name TEXT;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS subject_dob TEXT;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS issued_date TEXT;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS auto_created INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS scraped_source TEXT;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS scraped_raw TEXT;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS external_warrant_id TEXT;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS external_source_key TEXT;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS last_checked_at TEXT;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS last_check_result TEXT;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS priority INTEGER;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS jurisdiction TEXT;
ALTER TABLE warrants ADD COLUMN IF NOT EXISTS issuing_agency TEXT;

-- ── Part 3: Performance indexes ───────────────────────────────────────────
-- GET /unified filters archived_at IS NULL on every load — no index.
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
