-- Cross-system integration: link navigation trips to dispatch calls
-- and add indexes for cross-domain JOINs that were previously absent.

-- nav_trip_log.call_id — which dispatch call this trip was responding to
ALTER TABLE nav_trip_log ADD COLUMN call_id INTEGER REFERENCES calls_for_service(id);

-- Indexes for cross-system JOINs (all IF NOT EXISTS safe)
CREATE INDEX IF NOT EXISTS idx_nav_trip_officer ON nav_trip_log(officer_id);
CREATE INDEX IF NOT EXISTS idx_nav_trip_vehicle ON nav_trip_log(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_nav_trip_unit ON nav_trip_log(unit_id);
CREATE INDEX IF NOT EXISTS idx_nav_trip_call ON nav_trip_log(call_id);
CREATE INDEX IF NOT EXISTS idx_nav_trip_status ON nav_trip_log(status);

CREATE INDEX IF NOT EXISTS idx_fleet_assignments_vehicle ON fleet_assignments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_assignments_unit ON fleet_assignments(unit_id);

CREATE INDEX IF NOT EXISTS idx_call_vehicles_call ON call_vehicles(call_id);
CREATE INDEX IF NOT EXISTS idx_call_vehicles_vehicle ON call_vehicles(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_time_entries_officer ON time_entries(officer_id);
CREATE INDEX IF NOT EXISTS idx_gps_breadcrumbs_unit ON gps_breadcrumbs(unit_id);
