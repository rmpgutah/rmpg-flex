-- 0064_incident_subresource_columns.sql
-- Widen the incident NIBRS sub-resource tables so the IncidentsPage detail
-- panels (Offenses / Responding Officers / Supplements) can persist every
-- field the UI collects. The live tables were minimal — a POST that
-- referenced these columns 500'd ("no such column"); the officer timing
-- fields and supplement subject/status workflow had nowhere to land.
--
-- Already applied directly to live D1 (785de7ae) on 2026-06-01 via the
-- Cloudflare D1 API; this file is the repo record. D1 does NOT support
-- `IF NOT EXISTS` on ADD COLUMN, so a re-apply will error on the already-
-- present columns — that's expected and the deploy step is continue-on-error
-- (the Worker also tolerates the existing columns). See migrations/README.md.

-- incident_offenses: NIBRS coding + qualifiers the Add-Offense modal sends.
ALTER TABLE incident_offenses ADD COLUMN ucr_code TEXT;
ALTER TABLE incident_offenses ADD COLUMN nibrs_code TEXT;
ALTER TABLE incident_offenses ADD COLUMN attempted_completed TEXT DEFAULT 'completed';
ALTER TABLE incident_offenses ADD COLUMN counts INTEGER DEFAULT 1;
ALTER TABLE incident_offenses ADD COLUMN weapon_force TEXT;
ALTER TABLE incident_offenses ADD COLUMN notes TEXT;
ALTER TABLE incident_offenses ADD COLUMN created_by INTEGER;
ALTER TABLE incident_offenses ADD COLUMN created_at TEXT;

-- incident_officers: arrival/departure + action narrative per responder.
ALTER TABLE incident_officers ADD COLUMN arrived_at TEXT;
ALTER TABLE incident_officers ADD COLUMN departed_at TEXT;
ALTER TABLE incident_officers ADD COLUMN action_taken TEXT;
ALTER TABLE incident_officers ADD COLUMN notes TEXT;
ALTER TABLE incident_officers ADD COLUMN created_at TEXT;

-- supplemental_reports: free-form supplement subject + status workflow.
-- (`content` already holds the narrative; the client sends `narrative` and
-- the handler maps it to `content`.)
ALTER TABLE supplemental_reports ADD COLUMN subject TEXT;
ALTER TABLE supplemental_reports ADD COLUMN status TEXT DEFAULT 'draft';
ALTER TABLE supplemental_reports ADD COLUMN updated_at TEXT;
