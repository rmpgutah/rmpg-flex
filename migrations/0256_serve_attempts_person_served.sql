-- Columns for identifying WHO was served in a substitute-service or
-- personal-service attempt. Added by PR #3640 to the PUT handler, but
-- the migration was omitted, causing 500s on any attempt edit that
-- included these fields. D1 does not support IF NOT EXISTS on ADD COLUMN;
-- re-applying against a database that already has the column raises
-- "duplicate column name" which deploy swallows (continue-on-error).
ALTER TABLE serve_attempts ADD COLUMN person_served_name TEXT;
ALTER TABLE serve_attempts ADD COLUMN person_served_relationship TEXT;
ALTER TABLE serve_attempts ADD COLUMN person_served_description TEXT;
