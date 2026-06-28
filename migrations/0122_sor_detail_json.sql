-- 0122_sor_detail_json.sql
-- Capture-all-data: preserve the complete iCrimeWatch detail record
-- (all aliases, all offenses, vehicles, other known addresses, professional
-- licenses, status, age) alongside the flat search columns.
-- D1 has no IF NOT EXISTS on ADD COLUMN — re-apply may error (tolerated);
-- the scraper also reconciles this column at runtime.
ALTER TABLE utah_sex_offenders ADD COLUMN detail_json TEXT;
