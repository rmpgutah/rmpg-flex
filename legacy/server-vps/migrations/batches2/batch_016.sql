ALTER TABLE fleet_vehicles ADD COLUMN avg_mpg REAL;
-- Missing columns for fleet_maintenance (2)
ALTER TABLE fleet_maintenance ADD COLUMN labor_cost REAL;
ALTER TABLE fleet_maintenance ADD COLUMN service_tasks TEXT;
-- Missing columns for fleet_fuel_logs (2)
ALTER TABLE fleet_fuel_logs ADD COLUMN distance REAL;
ALTER TABLE fleet_fuel_logs ADD COLUMN efficiency REAL;
-- Missing columns for serve_queue (2)
ALTER TABLE serve_queue ADD COLUMN recipient_person_id INTEGER;
ALTER TABLE serve_queue ADD COLUMN property_id INTEGER;
-- Missing columns for citations (32)
ALTER TABLE citations ADD COLUMN section_id TEXT;
ALTER TABLE citations ADD COLUMN sector_id TEXT;
ALTER TABLE citations ADD COLUMN zone_id TEXT;
ALTER TABLE citations ADD COLUMN beat_id TEXT;
ALTER TABLE citations ADD COLUMN vehicle_vin TEXT;
ALTER TABLE citations ADD COLUMN vehicle_id INTEGER;
ALTER TABLE citations ADD COLUMN speed_recorded INTEGER;
ALTER TABLE citations ADD COLUMN radar_type TEXT;
ALTER TABLE citations ADD COLUMN bac_level REAL;
ALTER TABLE citations ADD COLUMN bond_amount REAL;
ALTER TABLE citations ADD COLUMN bond_type TEXT;
ALTER TABLE citations ADD COLUMN is_warning INTEGER;
ALTER TABLE citations ADD COLUMN is_equipment_violation INTEGER;
ALTER TABLE citations ADD COLUMN weather_conditions TEXT;
ALTER TABLE citations ADD COLUMN road_conditions TEXT;
ALTER TABLE citations ADD COLUMN accident_related INTEGER;
ALTER TABLE citations ADD COLUMN dui_related INTEGER;
ALTER TABLE citations ADD COLUMN school_zone INTEGER;
