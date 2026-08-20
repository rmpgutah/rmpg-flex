-- Device fingerprint columns on serve_receipts.
-- Captures the signing device's hardware/software profile for evidentiary
-- integrity — helps prove which specific device was used if the AOS is
-- contested in court.
ALTER TABLE serve_receipts ADD COLUMN device_fingerprint TEXT;
ALTER TABLE serve_receipts ADD COLUMN screen_resolution TEXT;
ALTER TABLE serve_receipts ADD COLUMN color_depth INTEGER;
ALTER TABLE serve_receipts ADD COLUMN timezone TEXT;
ALTER TABLE serve_receipts ADD COLUMN language TEXT;
ALTER TABLE serve_receipts ADD COLUMN languages TEXT;
ALTER TABLE serve_receipts ADD COLUMN platform TEXT;
ALTER TABLE serve_receipts ADD COLUMN hardware_concurrency INTEGER;
ALTER TABLE serve_receipts ADD COLUMN device_memory REAL;
ALTER TABLE serve_receipts ADD COLUMN max_touch_points INTEGER;
ALTER TABLE serve_receipts ADD COLUMN timezone_offset INTEGER;
