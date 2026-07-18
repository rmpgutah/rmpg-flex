-- The Warrants UI's bulk "Mark Reviewed" action (WarrantsPage.tsx) has
-- always posted to POST /warrants/bulk-review expecting a reviewed_at
-- column to stamp — the route never existed and neither did this column.
-- D1 does NOT support `IF NOT EXISTS` on `ADD COLUMN`; re-applying against
-- a database that already has it produces a harmless "duplicate column
-- name" error, swallowed by the continue-on-error deploy step.
ALTER TABLE warrants ADD COLUMN reviewed_at TEXT;
ALTER TABLE warrants ADD COLUMN reviewed_by INTEGER;
