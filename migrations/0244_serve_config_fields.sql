ALTER TABLE serve_nudge_settings ADD COLUMN mileage_rate REAL DEFAULT 0.67;
ALTER TABLE serve_nudge_settings ADD COLUMN business_hours_start TEXT DEFAULT '08:00';
ALTER TABLE serve_nudge_settings ADD COLUMN business_hours_end TEXT DEFAULT '20:00';
ALTER TABLE serve_nudge_settings ADD COLUMN business_hours_days TEXT DEFAULT '[1,2,3,4,5]';
ALTER TABLE serve_nudge_settings ADD COLUMN auto_geocode_on_intake INTEGER DEFAULT 1;
ALTER TABLE serve_nudge_settings ADD COLUMN geocode_confidence_min REAL DEFAULT 0.6;
