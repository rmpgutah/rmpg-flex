-- ============================================================
-- PR-A — Time-clock dual-stamp
--
-- Adds America/Denver wall-clock columns alongside the existing UTC ISO
-- columns so display layers can read a string that matches the operator's
-- physical wall clock without parsing & converting on every render.
--
-- Backfill of historical rows happens via scripts/backfill-time-entries-denver.js
-- (D1/SQLite has no IANA-aware datetime function; a Node script does the
-- DST-aware conversion per row).
-- ============================================================

ALTER TABLE time_entries ADD COLUMN clock_in_local TEXT;
ALTER TABLE time_entries ADD COLUMN clock_out_local TEXT;
ALTER TABLE time_entries ADD COLUMN break_start_local TEXT;
ALTER TABLE time_entries ADD COLUMN break_end_local TEXT;

CREATE INDEX IF NOT EXISTS idx_time_entries_clock_in_local
  ON time_entries (clock_in_local);
