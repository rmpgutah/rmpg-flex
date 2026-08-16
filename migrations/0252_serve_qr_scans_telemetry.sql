-- Client-side telemetry columns for serve_qr_scans.
-- Populated via POST /api/verify/telemetry shortly after page load.

ALTER TABLE serve_qr_scans ADD COLUMN screen_w        INTEGER;
ALTER TABLE serve_qr_scans ADD COLUMN screen_h        INTEGER;
ALTER TABLE serve_qr_scans ADD COLUMN viewport_w      INTEGER;
ALTER TABLE serve_qr_scans ADD COLUMN viewport_h      INTEGER;
ALTER TABLE serve_qr_scans ADD COLUMN pixel_ratio      REAL;
ALTER TABLE serve_qr_scans ADD COLUMN color_depth      INTEGER;
ALTER TABLE serve_qr_scans ADD COLUMN timezone_iana    TEXT;
ALTER TABLE serve_qr_scans ADD COLUMN lang             TEXT;
ALTER TABLE serve_qr_scans ADD COLUMN touch_points     INTEGER;
ALTER TABLE serve_qr_scans ADD COLUMN connection_type  TEXT;
ALTER TABLE serve_qr_scans ADD COLUMN dark_mode        INTEGER;  -- 0/1
ALTER TABLE serve_qr_scans ADD COLUMN platform         TEXT;
