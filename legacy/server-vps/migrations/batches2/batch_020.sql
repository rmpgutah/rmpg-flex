-- Add 14 missing property detail fields that PropertyFormModal sends
-- but were silently dropped because the columns didn't exist
ALTER TABLE properties ADD COLUMN inspection_status TEXT;
ALTER TABLE properties ADD COLUMN alarm_company TEXT;
ALTER TABLE properties ADD COLUMN alarm_account TEXT;
ALTER TABLE properties ADD COLUMN camera_system TEXT;
ALTER TABLE properties ADD COLUMN parking_info TEXT;
ALTER TABLE properties ADD COLUMN roof_access TEXT;
ALTER TABLE properties ADD COLUMN utility_shutoffs TEXT;
ALTER TABLE properties ADD COLUMN known_hazards TEXT;
ALTER TABLE properties ADD COLUMN contact_email TEXT;
ALTER TABLE properties ADD COLUMN secondary_contact_name TEXT;
ALTER TABLE properties ADD COLUMN secondary_contact_phone TEXT;
ALTER TABLE properties ADD COLUMN patrol_frequency TEXT;
ALTER TABLE properties ADD COLUMN opening_hours TEXT;
ALTER TABLE properties ADD COLUMN closing_hours TEXT;

-- Add archived_at + updated_at to tables that were missing them
-- (the worker filters on archived_at; missing column causes 500 errors)
ALTER TABLE persons ADD COLUMN archived_at TEXT;
ALTER TABLE persons ADD COLUMN updated_at TEXT;
ALTER TABLE vehicles_records ADD COLUMN archived_at TEXT;
ALTER TABLE vehicles_records ADD COLUMN updated_at TEXT;
ALTER TABLE evidence ADD COLUMN archived_at TEXT;
ALTER TABLE evidence ADD COLUMN updated_at TEXT;
