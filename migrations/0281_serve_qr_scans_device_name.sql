-- Device name / model string parsed from User-Agent.
-- e.g. "iPhone", "Samsung SM-G998B", "Pixel 7", "iPad"
ALTER TABLE serve_qr_scans ADD COLUMN device_name TEXT;

-- GPS accuracy in metres from browser Geolocation API.
ALTER TABLE serve_qr_scans ADD COLUMN geo_accuracy REAL;

-- Whether the subject granted or denied browser geolocation.
-- 'granted' | 'denied' | 'unavailable' | NULL (pending/not yet responded)
ALTER TABLE serve_qr_scans ADD COLUMN geo_permission TEXT;
