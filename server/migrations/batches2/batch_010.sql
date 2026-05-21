ALTER TABLE calls_for_service ADD COLUMN overdue_notified TEXT;
-- Missing columns for units (2)
ALTER TABLE units ADD COLUMN assigned_beat TEXT;
ALTER TABLE units ADD COLUMN mileage REAL;
-- Missing columns for incidents (8)
ALTER TABLE incidents ADD COLUMN section_id TEXT;
ALTER TABLE incidents ADD COLUMN statute_id INTEGER;
ALTER TABLE incidents ADD COLUMN statute_citation TEXT;
ALTER TABLE incidents ADD COLUMN citation_fine REAL;
ALTER TABLE incidents ADD COLUMN contract_id TEXT;
ALTER TABLE incidents ADD COLUMN assigned_detective_id INTEGER;
ALTER TABLE incidents ADD COLUMN weather_temperature REAL;
ALTER TABLE incidents ADD COLUMN weather_recorded_at TEXT;
-- Missing columns for persons (32)
ALTER TABLE persons ADD COLUMN height_feet INTEGER;
ALTER TABLE persons ADD COLUMN height_inches INTEGER;
ALTER TABLE persons ADD COLUMN watchlist_match TEXT;
ALTER TABLE persons ADD COLUMN watchlist_checked_at TEXT;
ALTER TABLE persons ADD COLUMN aliases TEXT;
ALTER TABLE persons ADD COLUMN photo TEXT;
ALTER TABLE persons ADD COLUMN ncic_number TEXT;
ALTER TABLE persons ADD COLUMN sor_number TEXT;
ALTER TABLE persons ADD COLUMN fbi_number TEXT;
ALTER TABLE persons ADD COLUMN state_id_number TEXT;
ALTER TABLE persons ADD COLUMN passport_number TEXT;
ALTER TABLE persons ADD COLUMN passport_country TEXT;
ALTER TABLE persons ADD COLUMN immigration_status TEXT;
ALTER TABLE persons ADD COLUMN disability_flags TEXT;
