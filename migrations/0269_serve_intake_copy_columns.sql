-- Migration 0269: ServeIntake → Process Server / Dispatch copy columns
-- Attorney contact on serve_queue (Process Server job cards/forms).
-- Matching Dispatch CFS ext fields so mapDbCall can surface them.

ALTER TABLE serve_queue ADD COLUMN attorney_phone TEXT;
ALTER TABLE serve_queue ADD COLUMN attorney_email TEXT;
ALTER TABLE serve_queue ADD COLUMN attorney_bar_number TEXT;

ALTER TABLE calls_for_service_ext ADD COLUMN attorney_name TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN jurisdiction TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN deadline TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN time_window TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN service_instructions TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN plaintiff_name TEXT;
