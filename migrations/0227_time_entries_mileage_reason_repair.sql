-- 0227_time_entries_mileage_reason_repair.sql
-- Repair migration for three D1 column gaps discovered 2026-08-07.
--
-- The Edit Time Entry form (TimeEntryEditModal) writes starting_mileage,
-- ending_mileage, and a required "Reason for change" through
-- PUT /personnel/time/:id. All three were absent on the live DB, causing
-- every time-entry correction to fail silently at the D1 layer.
--
-- Root cause: migration 0084 added the mileage columns and migration 0093
-- re-applied them, but both ran under `continue-on-error` in deploy.yml and
-- the tracking INSERT into d1_migrations was never confirmed on the live DB
-- (785de7ae-3e7a-4e01-93bb-d24ddd813f6b). Similarly, the `reason` column on
-- `time_entry_edits` exists in the 0093 CREATE TABLE IF NOT EXISTS definition
-- but IF NOT EXISTS is a no-op when the table pre-dated 0093 without that
-- column — the ALTER path was never written.
--
-- D1 does NOT support IF NOT EXISTS on ADD COLUMN; these ALTERs fail with
-- "duplicate column name" on re-apply. deploy.yml tolerates that
-- (continue-on-error). Apply directly to live D1 via scripts/apply-migration.sh
-- after merge.

-- ── time_entries — odometer readings captured at shift start / end ──────────
-- PUT /personnel/time/:id UPDATE:
--   starting_mileage = ?, ending_mileage = ?, total_miles = ?
-- GET /personnel/time SELECT includes starting_mileage and ending_mileage.
ALTER TABLE time_entries ADD COLUMN starting_mileage REAL;
ALTER TABLE time_entries ADD COLUMN ending_mileage REAL;
ALTER TABLE time_entries ADD COLUMN total_miles REAL;

-- ── time_entry_edits — audit trail "Reason for change" field ────────────────
-- Every PUT /personnel/time/:id audit row carries a reason so corrections
-- to payroll-affecting fields are explainable. The route INSERT is:
--   INSERT INTO time_entry_edits (..., reason, ...) VALUES (...)
-- Without this column every mileage or time correction INSERTs a null
-- into a NOT NULL context on DBs built before 0093.
ALTER TABLE time_entry_edits ADD COLUMN reason TEXT;
