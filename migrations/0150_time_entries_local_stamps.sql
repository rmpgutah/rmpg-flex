-- ============================================================
-- PR-A — Time-clock dual-stamp
--
-- Adds America/Denver wall-clock columns alongside the existing UTC ISO
-- columns so display layers can read a string that matches the operator's
-- physical wall clock without parsing & converting on every render.
--
-- `time_entries` stores break end as a CLEARED `break_start` plus accumulated
-- `break_minutes` duration — there is no `break_end` UTC column, so no
-- `break_end_local` either.
--
-- Backfill of historical rows happens via scripts/backfill-time-entries-denver.js
-- (D1/SQLite has no IANA-aware datetime function; a Node script does the
-- DST-aware conversion per row).
--
-- D1 does NOT support `IF NOT EXISTS` on ADD COLUMN. Re-application errors
-- with "duplicate column name" — deploy.yml's apply step has
-- `continue-on-error: true` so this is non-fatal.
--
-- 🔴 After merge: apply directly to live D1 (785de7ae) via
--    `scripts/apply-migration.sh 0150_time_entries_local_stamps.sql`
--    per CLAUDE.md gotcha #4. Then run the backfill script.
-- ============================================================

ALTER TABLE time_entries ADD COLUMN clock_in_local TEXT;
ALTER TABLE time_entries ADD COLUMN clock_out_local TEXT;
ALTER TABLE time_entries ADD COLUMN break_start_local TEXT;

CREATE INDEX IF NOT EXISTS idx_time_entries_clock_in_local
  ON time_entries (clock_in_local);
