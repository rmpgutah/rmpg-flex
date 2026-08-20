-- Geo + device columns for serve_qr_scans.
-- IP-based geo comes from Cloudflare headers (cf-ipcity / cf-ipregion /
-- cf-ipcountry / cf-iplatitude / cf-iplongitude) captured at scan time.
-- GPS-accurate coords arrive later via POST /api/verify/location if the
-- subject grants browser location permission.

ALTER TABLE serve_qr_scans ADD COLUMN geo_city    TEXT;
ALTER TABLE serve_qr_scans ADD COLUMN geo_region  TEXT;
ALTER TABLE serve_qr_scans ADD COLUMN geo_country TEXT;
ALTER TABLE serve_qr_scans ADD COLUMN geo_lat     REAL;
ALTER TABLE serve_qr_scans ADD COLUMN geo_lon     REAL;
ALTER TABLE serve_qr_scans ADD COLUMN geo_source  TEXT;   -- 'ip' | 'gps'
ALTER TABLE serve_qr_scans ADD COLUMN device_type TEXT;   -- mobile | tablet | desktop | unknown
