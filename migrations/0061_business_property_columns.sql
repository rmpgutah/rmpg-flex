-- 0061_business_property_columns.sql
-- Businesses are stored in the `properties` table (rows with a non-empty
-- business_type). The BusinessTab form submits a full business profile, but the
-- live `properties` table was missing most of those columns — including general
-- `phone`/`email` — so POST/PUT /records/businesses either 500'd (writing the
-- non-existent phone/email columns) or silently dropped EIN/DBA/owner/contact/
-- industry/revenue/status. This adds the missing columns.
--
-- NOTE: D1 does not support `IF NOT EXISTS` on ADD COLUMN; re-applying will
-- error per-column and the deploy step continues (continue-on-error). These
-- columns were also applied directly to live D1 (785de7ae) on 2026-06-01.
-- `properties` goes from ~49 to ~61 columns — well under the 100-col cap, and
-- `properties` is not a cap-watched table.
ALTER TABLE properties ADD COLUMN phone TEXT;
ALTER TABLE properties ADD COLUMN email TEXT;
ALTER TABLE properties ADD COLUMN dba_name TEXT;
ALTER TABLE properties ADD COLUMN ein TEXT;
ALTER TABLE properties ADD COLUMN license_number TEXT;
ALTER TABLE properties ADD COLUMN website TEXT;
ALTER TABLE properties ADD COLUMN contact_name TEXT;
ALTER TABLE properties ADD COLUMN contact_phone TEXT;
ALTER TABLE properties ADD COLUMN industry TEXT;
ALTER TABLE properties ADD COLUMN employee_count TEXT;
ALTER TABLE properties ADD COLUMN annual_revenue TEXT;
ALTER TABLE properties ADD COLUMN status TEXT DEFAULT 'active';
