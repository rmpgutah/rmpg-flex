-- 0086: Offender registry CRUD + code-enforcement columns (404 sweep 2026-06-09)
--
-- offender_alerts gains the fields the OffenderRegistryPage create form
-- writes (expiration_date, notes, created_by, effective_date).
-- code_violations gains the form-only fields (notes, zone_beat,
-- sector_id, zone_id, beat_id).
-- offender_contacts is the new contact-log table behind
-- GET/POST /api/offender-registry/:id/contact(s).
--
-- NOTE: D1 has no IF NOT EXISTS for ADD COLUMN — these ALTERs fail
-- harmlessly on re-apply (deploy.yml runs migrations with
-- continue-on-error; the live DB is also patched directly).

ALTER TABLE offender_alerts ADD COLUMN expiration_date TEXT;
ALTER TABLE offender_alerts ADD COLUMN notes TEXT;
ALTER TABLE offender_alerts ADD COLUMN created_by INTEGER;
ALTER TABLE offender_alerts ADD COLUMN effective_date TEXT;

ALTER TABLE code_violations ADD COLUMN notes TEXT;
ALTER TABLE code_violations ADD COLUMN zone_beat TEXT;
ALTER TABLE code_violations ADD COLUMN sector_id TEXT;
ALTER TABLE code_violations ADD COLUMN zone_id TEXT;
ALTER TABLE code_violations ADD COLUMN beat_id TEXT;

CREATE TABLE IF NOT EXISTS offender_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,
  officer_id INTEGER,
  contact_type TEXT NOT NULL DEFAULT 'field_contact',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_offender_contacts_alert ON offender_contacts(alert_id);
