-- migrations/0241_serve_queue_geocode_source.sql
ALTER TABLE serve_queue ADD COLUMN geocode_source TEXT;
