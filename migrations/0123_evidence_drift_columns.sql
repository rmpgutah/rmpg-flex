-- migrations/0123_evidence_drift_columns.sql
-- Reconcile the `evidence` table with the columns its write path
-- (EVIDENCE_WRITABLE_COLUMNS in src/routes/records.ts) actually emits.
--
-- These columns were created on the old VPS by boot-time addCol() calls
-- (legacy/server-vps/src/models/database.ts) that died in the Cloudflare
-- cutover; no migration ever replaced them, so live D1 lacked them and an
-- evidence INSERT/UPDATE touching one (e.g. narcotics_flag) failed with
-- "table evidence has no column named …". Types mirror the legacy addCol()
-- definitions exactly.
--
-- ⚠️ Apply directly to live 785de7ae after merge (deploy migration step is
-- continue-on-error). The runtime reconciler ensureEvidenceSchema() in
-- records.ts is the idempotent self-heal; D1 has no IF NOT EXISTS on ADD
-- COLUMN, so a re-apply of these ALTERs errors on an already-migrated DB —
-- tolerated.
ALTER TABLE evidence ADD COLUMN case_id INTEGER;
ALTER TABLE evidence ADD COLUMN narcotics_flag INTEGER DEFAULT 0;
ALTER TABLE evidence ADD COLUMN temperature_sensitive INTEGER DEFAULT 0;
ALTER TABLE evidence ADD COLUMN collection_context TEXT;
ALTER TABLE evidence ADD COLUMN court_hold_reference TEXT;
ALTER TABLE evidence ADD COLUMN checked_out_by INTEGER;
ALTER TABLE evidence ADD COLUMN checked_out_at TEXT;
ALTER TABLE evidence ADD COLUMN checkout_reason TEXT;
ALTER TABLE evidence ADD COLUMN expected_return_date TEXT;
ALTER TABLE evidence ADD COLUMN condition_on_return TEXT;
ALTER TABLE evidence ADD COLUMN release_status TEXT;
ALTER TABLE evidence ADD COLUMN release_requested_by INTEGER;
ALTER TABLE evidence ADD COLUMN release_requested_at TEXT;
ALTER TABLE evidence ADD COLUMN release_to TEXT;
ALTER TABLE evidence ADD COLUMN release_reason TEXT;
ALTER TABLE evidence ADD COLUMN release_approved_by INTEGER;
ALTER TABLE evidence ADD COLUMN release_approved_at TEXT;
ALTER TABLE evidence ADD COLUMN location_detail TEXT;
ALTER TABLE evidence ADD COLUMN flags TEXT;
