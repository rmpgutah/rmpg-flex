-- Prevent duplicate Daily Activity Reports for the same officer on the same shift date.
-- Two code paths (MDT "End Shift" + personnel clock-out) can both trigger autoCompileShiftDar;
-- this unique index makes the second INSERT fail cleanly instead of creating a duplicate row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dar_officer_shift_date
  ON daily_activity_reports(officer_id, shift_date);
