-- Hardening columns for QR scan forensics.
-- CF network metadata for VPN/proxy detection + repeat-scan correlation.

-- Cloudflare Autonomous System Number — identifies the ISP/org.
ALTER TABLE serve_qr_scans ADD COLUMN cf_asn      INTEGER;
-- Cloudflare Ray ID — unique request trace for CF support correlation.
ALTER TABLE serve_qr_scans ADD COLUMN cf_ray      TEXT;
-- Parsed browser family from User-Agent (e.g. "Chrome", "Safari", "Firefox").
ALTER TABLE serve_qr_scans ADD COLUMN browser     TEXT;
-- Parsed browser version (e.g. "126.0").
ALTER TABLE serve_qr_scans ADD COLUMN browser_ver TEXT;
-- Parsed OS family (e.g. "iOS", "Android", "Windows", "macOS").
ALTER TABLE serve_qr_scans ADD COLUMN os_family   TEXT;
-- Parsed OS version (e.g. "17.5", "14", "11").
ALTER TABLE serve_qr_scans ADD COLUMN os_ver      TEXT;

-- Composite device fingerprint hash (SHA-256 of deterministic browser signals)
-- for correlating repeat scans from the same device across different IPs/times.
ALTER TABLE serve_scan_details ADD COLUMN device_fingerprint TEXT;
-- Audio oscillator fingerprint hash (SHA-256) — complements canvas fingerprint.
ALTER TABLE serve_scan_details ADD COLUMN audio_fingerprint  TEXT;
-- Installed browser plugins / PDF viewer type.
ALTER TABLE serve_scan_details ADD COLUMN plugins_hash       TEXT;
-- WebGL unmasked extensions list hash.
ALTER TABLE serve_scan_details ADD COLUMN webgl_extensions   TEXT;
-- Performance navigation timing (JSON) — page load speed as device profile.
ALTER TABLE serve_scan_details ADD COLUMN nav_timing         TEXT;

CREATE INDEX IF NOT EXISTS idx_serve_scan_details_device_fp
  ON serve_scan_details(device_fingerprint)
  WHERE device_fingerprint IS NOT NULL;
