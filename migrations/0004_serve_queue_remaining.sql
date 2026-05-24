-- Migration 0004: Add remaining serve_queue columns used by serve-worker.ts
-- These columns mirror the Express schema from database.ts :1355 and are
-- required by serve-worker.ts POST /api/serve (create job endpoint).

ALTER TABLE serve_queue ADD COLUMN sm_job_id INTEGER;
ALTER TABLE serve_queue ADD COLUMN officer_id INTEGER;
ALTER TABLE serve_queue ADD COLUMN call_id INTEGER;
ALTER TABLE serve_queue ADD COLUMN serve_date TEXT;
ALTER TABLE serve_queue ADD COLUMN recipient_name TEXT;
ALTER TABLE serve_queue ADD COLUMN recipient_address TEXT;
ALTER TABLE serve_queue ADD COLUMN recipient_city TEXT;
ALTER TABLE serve_queue ADD COLUMN recipient_state TEXT;
ALTER TABLE serve_queue ADD COLUMN recipient_zip TEXT;
ALTER TABLE serve_queue ADD COLUMN recipient_lat REAL;
ALTER TABLE serve_queue ADD COLUMN recipient_lng REAL;
ALTER TABLE serve_queue ADD COLUMN document_type TEXT;
ALTER TABLE serve_queue ADD COLUMN court_name TEXT;
ALTER TABLE serve_queue ADD COLUMN jurisdiction TEXT;
ALTER TABLE serve_queue ADD COLUMN client_name TEXT;
ALTER TABLE serve_queue ADD COLUMN attorney_name TEXT;
ALTER TABLE serve_queue ADD COLUMN priority TEXT;
ALTER TABLE serve_queue ADD COLUMN time_window TEXT;
ALTER TABLE serve_queue ADD COLUMN deadline TEXT;
ALTER TABLE serve_queue ADD COLUMN max_attempts INTEGER;
ALTER TABLE serve_queue ADD COLUMN service_instructions TEXT;
ALTER TABLE serve_queue ADD COLUMN notes TEXT;
ALTER TABLE serve_queue ADD COLUMN attempt_count INTEGER;
ALTER TABLE serve_queue ADD COLUMN sort_order INTEGER;
ALTER TABLE serve_queue ADD COLUMN court_date TEXT;
