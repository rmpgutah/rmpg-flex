-- 0087_use_of_force_real_schema.sql
-- The live use_of_force table was a stub (id, created_at) — the POST handler
-- inserted only created_at, so every field officers entered in the 13-field
-- Use of Force report form was silently discarded while the UI showed success
-- (found in the 2026-06-10 full-functionality audit). Applied directly to live
-- 785de7ae on 2026-06-10; recorded here for local-dev parity. D1 has no
-- IF NOT EXISTS for ADD COLUMN — re-applies fail per-statement harmlessly
-- (deploy.yml runs migrations with continue-on-error).
ALTER TABLE use_of_force ADD COLUMN incident_id INTEGER;
ALTER TABLE use_of_force ADD COLUMN officer_id INTEGER;
ALTER TABLE use_of_force ADD COLUMN subject_person_id INTEGER;
ALTER TABLE use_of_force ADD COLUMN force_type TEXT;
ALTER TABLE use_of_force ADD COLUMN force_level TEXT;
ALTER TABLE use_of_force ADD COLUMN justification TEXT;
ALTER TABLE use_of_force ADD COLUMN subject_injuries TEXT;
ALTER TABLE use_of_force ADD COLUMN officer_injuries TEXT;
ALTER TABLE use_of_force ADD COLUMN de_escalation_attempted INTEGER DEFAULT 0;
ALTER TABLE use_of_force ADD COLUMN de_escalation_details TEXT;
ALTER TABLE use_of_force ADD COLUMN weapons_used TEXT;
ALTER TABLE use_of_force ADD COLUMN body_camera_active INTEGER DEFAULT 1;
ALTER TABLE use_of_force ADD COLUMN witness_officers TEXT;
ALTER TABLE use_of_force ADD COLUMN narrative TEXT;
ALTER TABLE use_of_force ADD COLUMN status TEXT DEFAULT 'submitted';
ALTER TABLE use_of_force ADD COLUMN reviewed_by INTEGER;
ALTER TABLE use_of_force ADD COLUMN reviewed_at TEXT;
ALTER TABLE use_of_force ADD COLUMN review_notes TEXT;
ALTER TABLE use_of_force ADD COLUMN updated_at TEXT;
