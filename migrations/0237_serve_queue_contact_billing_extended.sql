-- Migration 0237: Extended contact, billing, and operational fields for serve_queue
-- Adds 17 new columns supporting 40 process-server enhancements:
--   Contact: phone, email, DOB
--   Employment: employer name + address (workplace serve)
--   Service classification: serve_type, case_type, return_date, relationship, co_defendants
--   Billing: serve_fee, rush_fee, payment_status
--   Operations: diligence_required, mileage_actual, contact_restrictions, building_access_notes

ALTER TABLE serve_queue ADD COLUMN recipient_phone        TEXT;
ALTER TABLE serve_queue ADD COLUMN recipient_email        TEXT;
ALTER TABLE serve_queue ADD COLUMN recipient_dob          TEXT;
ALTER TABLE serve_queue ADD COLUMN recipient_employer     TEXT;
ALTER TABLE serve_queue ADD COLUMN recipient_employer_address TEXT;
ALTER TABLE serve_queue ADD COLUMN serve_type             TEXT DEFAULT 'personal';
ALTER TABLE serve_queue ADD COLUMN case_type              TEXT;
ALTER TABLE serve_queue ADD COLUMN return_date            TEXT;
ALTER TABLE serve_queue ADD COLUMN co_defendants          TEXT;
ALTER TABLE serve_queue ADD COLUMN relationship           TEXT;
ALTER TABLE serve_queue ADD COLUMN serve_fee              REAL;
ALTER TABLE serve_queue ADD COLUMN rush_fee               REAL;
ALTER TABLE serve_queue ADD COLUMN payment_status         TEXT DEFAULT 'unpaid';
ALTER TABLE serve_queue ADD COLUMN diligence_required     INTEGER DEFAULT 0;
ALTER TABLE serve_queue ADD COLUMN mileage_actual         REAL;
ALTER TABLE serve_queue ADD COLUMN contact_restrictions   TEXT;
ALTER TABLE serve_queue ADD COLUMN building_access_notes  TEXT;

CREATE INDEX IF NOT EXISTS idx_serve_queue_serve_type   ON serve_queue(serve_type);
CREATE INDEX IF NOT EXISTS idx_serve_queue_case_type    ON serve_queue(case_type);
CREATE INDEX IF NOT EXISTS idx_serve_queue_payment_status ON serve_queue(payment_status);
