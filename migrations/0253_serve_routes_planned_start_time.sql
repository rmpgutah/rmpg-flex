-- Add planned_start_time to serve_routes so the Route Planner's chosen
-- shift start is stored alongside the route and can be used as the ETA
-- anchor when loading a saved route in ServePage.
ALTER TABLE serve_routes ADD COLUMN planned_start_time TEXT;
