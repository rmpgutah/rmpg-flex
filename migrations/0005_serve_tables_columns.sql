-- Migration 0005: Add missing columns to serve_attempts, serve_routes, serve_skip_traces
-- Production D1 had only (id, created_at) for these tables. The worker endpoints
-- INSERT with the full column sets from database.ts schema definitions.

-- serve_attempts
ALTER TABLE serve_attempts ADD COLUMN serve_queue_id INTEGER;
ALTER TABLE serve_attempts ADD COLUMN attempt_number INTEGER DEFAULT 1;
ALTER TABLE serve_attempts ADD COLUMN attempt_at TEXT;
ALTER TABLE serve_attempts ADD COLUMN officer_id INTEGER;
ALTER TABLE serve_attempts ADD COLUMN result TEXT;
ALTER TABLE serve_attempts ADD COLUMN latitude REAL;
ALTER TABLE serve_attempts ADD COLUMN longitude REAL;
ALTER TABLE serve_attempts ADD COLUMN notes TEXT;
ALTER TABLE serve_attempts ADD COLUMN attempt_type TEXT;
ALTER TABLE serve_attempts ADD COLUMN photo_ids TEXT;
ALTER TABLE serve_attempts ADD COLUMN signature_data TEXT;

-- serve_routes
ALTER TABLE serve_routes ADD COLUMN officer_id INTEGER;
ALTER TABLE serve_routes ADD COLUMN route_date TEXT;
ALTER TABLE serve_routes ADD COLUMN optimized_order_json TEXT;
ALTER TABLE serve_routes ADD COLUMN waypoints_json TEXT;
ALTER TABLE serve_routes ADD COLUMN total_distance_miles REAL;
ALTER TABLE serve_routes ADD COLUMN total_time_minutes REAL;
ALTER TABLE serve_routes ADD COLUMN start_lat REAL;
ALTER TABLE serve_routes ADD COLUMN start_lng REAL;
ALTER TABLE serve_routes ADD COLUMN end_lat REAL;
ALTER TABLE serve_routes ADD COLUMN end_lng REAL;
ALTER TABLE serve_routes ADD COLUMN notes TEXT;
ALTER TABLE serve_routes ADD COLUMN updated_at TEXT;

-- serve_skip_traces
ALTER TABLE serve_skip_traces ADD COLUMN serve_queue_id INTEGER;
ALTER TABLE serve_skip_traces ADD COLUMN searched_at TEXT;
ALTER TABLE serve_skip_traces ADD COLUMN search_type TEXT;
ALTER TABLE serve_skip_traces ADD COLUMN search_query TEXT;
ALTER TABLE serve_skip_traces ADD COLUMN results_json TEXT;
ALTER TABLE serve_skip_traces ADD COLUMN addresses_found_json TEXT;
ALTER TABLE serve_skip_traces ADD COLUMN searched_by INTEGER;
