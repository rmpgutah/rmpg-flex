ALTER TABLE evidence ADD COLUMN estimated_value REAL;
ALTER TABLE evidence ADD COLUMN category TEXT;
ALTER TABLE evidence ADD COLUMN notes TEXT;
ALTER TABLE evidence ADD COLUMN updated_at TEXT;
ALTER TABLE evidence ADD COLUMN retention_until TEXT;
ALTER TABLE evidence ADD COLUMN disposition TEXT;
ALTER TABLE evidence ADD COLUMN storage_temperature REAL;
ALTER TABLE evidence ADD COLUMN is_biological INTEGER;
-- Missing columns for time_entries (4)
ALTER TABLE time_entries ADD COLUMN notes TEXT;
ALTER TABLE time_entries ADD COLUMN edit_reason TEXT;
ALTER TABLE time_entries ADD COLUMN edited_by INTEGER;
ALTER TABLE time_entries ADD COLUMN edited_at TEXT;
-- Missing columns for credentials (1)
ALTER TABLE credentials ADD COLUMN issuing_authority TEXT;
-- Missing columns for patrol_checkpoints (3)
ALTER TABLE patrol_checkpoints ADD COLUMN assigned_officer_id INTEGER;
ALTER TABLE patrol_checkpoints ADD COLUMN location_description TEXT;
ALTER TABLE patrol_checkpoints ADD COLUMN special_instructions TEXT;
-- Missing columns for patrol_scans (1)
ALTER TABLE patrol_scans ADD COLUMN weather_json TEXT;
-- Missing columns for warrants (5)
ALTER TABLE warrants ADD COLUMN statute_id INTEGER;
ALTER TABLE warrants ADD COLUMN statute_citation TEXT;
ALTER TABLE warrants ADD COLUMN external_warrant_id TEXT;
ALTER TABLE warrants ADD COLUMN external_source_key TEXT;
ALTER TABLE warrants ADD COLUMN auto_created INTEGER;
-- Missing columns for fleet_vehicles (4)
ALTER TABLE fleet_vehicles ADD COLUMN total_maintenance_cost REAL;
ALTER TABLE fleet_vehicles ADD COLUMN total_fuel_cost REAL;
ALTER TABLE fleet_vehicles ADD COLUMN total_trips INTEGER;
