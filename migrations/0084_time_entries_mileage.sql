-- 0084_time_entries_mileage.sql
-- Capture starting and ending odometer readings on the time_entry that
-- bookends a shift. The dispatch /duty/start and /duty/end handlers write
-- these alongside the clock-in / clock-out timestamps so payroll + fleet
-- audits can reconcile hours-vs-miles for a single shift in one row.
--
-- total_miles is denormalized (ending - starting) for cheap reporting;
-- the duty handler computes it at /end. Officers can't write it directly.
--
-- D1 does NOT support `IF NOT EXISTS` on ADD COLUMN; re-applying this
-- migration on a DB that already has the columns will fail loudly — that
-- is fine per the project's idempotency convention (deploy.yml continues
-- on error and the Worker boot reconciler handles drift).

ALTER TABLE time_entries ADD COLUMN starting_mileage REAL;
ALTER TABLE time_entries ADD COLUMN ending_mileage REAL;
ALTER TABLE time_entries ADD COLUMN total_miles REAL;
