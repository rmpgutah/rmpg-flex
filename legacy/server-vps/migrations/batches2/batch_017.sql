ALTER TABLE citations ADD COLUMN construction_zone INTEGER;
ALTER TABLE citations ADD COLUMN commercial_vehicle INTEGER;
ALTER TABLE citations ADD COLUMN hazmat INTEGER;
ALTER TABLE citations ADD COLUMN voided_reason TEXT;
ALTER TABLE citations ADD COLUMN voided_by INTEGER;
ALTER TABLE citations ADD COLUMN voided_at TEXT;
ALTER TABLE citations ADD COLUMN court_time TEXT;
ALTER TABLE citations ADD COLUMN court_room TEXT;
ALTER TABLE citations ADD COLUMN appearance_required INTEGER;
ALTER TABLE citations ADD COLUMN plea TEXT;
ALTER TABLE citations ADD COLUMN verdict TEXT;
ALTER TABLE citations ADD COLUMN sentence TEXT;
ALTER TABLE citations ADD COLUMN disposition_date TEXT;
ALTER TABLE citations ADD COLUMN case_id INTEGER;
-- Missing columns for field_interviews (7)
ALTER TABLE field_interviews ADD COLUMN date TEXT;
ALTER TABLE field_interviews ADD COLUMN gang_affiliation TEXT;
ALTER TABLE field_interviews ADD COLUMN section_id INTEGER;
ALTER TABLE field_interviews ADD COLUMN zone_id INTEGER;
ALTER TABLE field_interviews ADD COLUMN beat_id INTEGER;
ALTER TABLE field_interviews ADD COLUMN zone_beat TEXT;
ALTER TABLE field_interviews ADD COLUMN updated_at TEXT;
-- Missing columns for trespass_orders (1)
ALTER TABLE trespass_orders ADD COLUMN subject_photo_url TEXT;
-- Missing columns for cases (2)
ALTER TABLE cases ADD COLUMN deadline TEXT;
ALTER TABLE cases ADD COLUMN sla_hours INTEGER;
-- Missing columns for court_events (8)
ALTER TABLE court_events ADD COLUMN continuance_count INTEGER;
