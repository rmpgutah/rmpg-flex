ALTER TABLE vehicles_records ADD COLUMN owner_dl_number TEXT;
ALTER TABLE vehicles_records ADD COLUMN owner_dob TEXT;
ALTER TABLE vehicles_records ADD COLUMN primary_driver_name TEXT;
ALTER TABLE vehicles_records ADD COLUMN registered_owner TEXT;
ALTER TABLE vehicles_records ADD COLUMN exterior_condition TEXT;
ALTER TABLE vehicles_records ADD COLUMN interior_condition TEXT;
ALTER TABLE vehicles_records ADD COLUMN title_status TEXT;
ALTER TABLE vehicles_records ADD COLUMN window_tint TEXT;
ALTER TABLE vehicles_records ADD COLUMN modifications TEXT;
ALTER TABLE vehicles_records ADD COLUMN equipment_notes TEXT;
ALTER TABLE vehicles_records ADD COLUMN vehicle_use TEXT;
ALTER TABLE vehicles_records ADD COLUMN ncic_entry_number TEXT;
ALTER TABLE vehicles_records ADD COLUMN estimated_value REAL;
ALTER TABLE vehicles_records ADD COLUMN tow_location TEXT;
-- Missing columns for bolos (2)
ALTER TABLE bolos ADD COLUMN auto_expire_hours INTEGER;
ALTER TABLE bolos ADD COLUMN expired_at TEXT;
-- Missing columns for messages (14)
ALTER TABLE messages ADD COLUMN subject TEXT;
ALTER TABLE messages ADD COLUMN parent_id INTEGER;
ALTER TABLE messages ADD COLUMN thread_id TEXT;
ALTER TABLE messages ADD COLUMN case_id INTEGER;
ALTER TABLE messages ADD COLUMN file_url TEXT;
ALTER TABLE messages ADD COLUMN edited_at TEXT;
ALTER TABLE messages ADD COLUMN scheduled_at TEXT;
ALTER TABLE messages ADD COLUMN attachment_url TEXT;
ALTER TABLE messages ADD COLUMN attachment_name TEXT;
