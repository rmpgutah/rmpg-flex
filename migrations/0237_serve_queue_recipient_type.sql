-- Migration 0237: Recipient type differentiator + business-specific fields for PS-302
-- Adds nullable columns to serve_queue so existing rows remain valid.
ALTER TABLE serve_queue ADD COLUMN recipient_type TEXT DEFAULT NULL;      -- 'individual' | 'business'
ALTER TABLE serve_queue ADD COLUMN business_name TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN business_dba TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN business_ein TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN business_sos_filing TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN business_state_of_inc TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN registered_agent_name TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN registered_agent_title TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN registered_office_address TEXT DEFAULT NULL;
