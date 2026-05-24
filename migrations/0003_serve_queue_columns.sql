-- Migration 0003: Add missing columns to serve_queue for intake processing
-- The serve_intake INSERT requires 16 columns but the production table
-- only had 4 (id, created_at, recipient_person_id, property_id). This
-- migration adds all columns needed by serveIntake-worker.ts POST /intake.

ALTER TABLE serve_queue ADD COLUMN client_id INTEGER;
ALTER TABLE serve_queue ADD COLUMN case_number TEXT;
ALTER TABLE serve_queue ADD COLUMN defendant_name TEXT;
ALTER TABLE serve_queue ADD COLUMN plaintiff_name TEXT;
ALTER TABLE serve_queue ADD COLUMN defendant_address TEXT;
ALTER TABLE serve_queue ADD COLUMN defendant_city TEXT;
ALTER TABLE serve_queue ADD COLUMN defendant_state TEXT;
ALTER TABLE serve_queue ADD COLUMN defendant_zip TEXT;
ALTER TABLE serve_queue ADD COLUMN instructions TEXT;
ALTER TABLE serve_queue ADD COLUMN document_text TEXT;
ALTER TABLE serve_queue ADD COLUMN parsed_data TEXT;
ALTER TABLE serve_queue ADD COLUMN status TEXT DEFAULT 'pending';
ALTER TABLE serve_queue ADD COLUMN assigned_officer_id INTEGER;
ALTER TABLE serve_queue ADD COLUMN created_by INTEGER;
ALTER TABLE serve_queue ADD COLUMN updated_at TEXT;
