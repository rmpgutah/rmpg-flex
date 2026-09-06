-- Court-grade forensic device profiling for QR scan service-of-process evidence.
-- Captures enough independent signals to uniquely identify a device and withstand
-- a court challenge that the subject opened the notice on their own device.

-- ── serve_qr_scans: server-side metadata (captured from CF + request headers) ──

-- TLS version used by the connecting browser (e.g. "TLSv1.3").
ALTER TABLE serve_qr_scans ADD COLUMN tls_version TEXT;
-- TLS cipher suite negotiated (e.g. "AEAD-AES256-GCM-SHA384").
ALTER TABLE serve_qr_scans ADD COLUMN tls_cipher  TEXT;
-- Accept-Language header — full language preference list is highly identifying.
ALTER TABLE serve_qr_scans ADD COLUMN http_accept_lang TEXT;
-- ISP / AS Organization name from CF (e.g. "Comcast Cable Communications").
ALTER TABLE serve_qr_scans ADD COLUMN isp_name TEXT;
-- Whether CF heuristics flag this IP as likely VPN/proxy/hosting.
ALTER TABLE serve_qr_scans ADD COLUMN vpn_detected INTEGER;
-- HTTP protocol version (e.g. "HTTP/2", "h3").
ALTER TABLE serve_qr_scans ADD COLUMN http_protocol TEXT;
-- CF postal code for the connecting IP.
ALTER TABLE serve_qr_scans ADD COLUMN geo_postal TEXT;

-- ── serve_scan_details: client-side forensic signals (captured silently in-browser) ──

-- Client Hints device model (e.g. "Pixel 7", "SM-S918B") — Chromium only.
ALTER TABLE serve_scan_details ADD COLUMN ch_model TEXT;
-- Client Hints platform version (e.g. "17.5.1" on iOS).
ALTER TABLE serve_scan_details ADD COLUMN ch_platform_ver TEXT;
-- Client Hints CPU architecture + bitness (e.g. "arm/64", "x86/64").
ALTER TABLE serve_scan_details ADD COLUMN ch_arch TEXT;
-- SHA-256 of font detection probe — which system fonts are installed.
ALTER TABLE serve_scan_details ADD COLUMN font_fingerprint TEXT;
-- Engine-specific math precision values hash (differs per JS engine build).
ALTER TABLE serve_scan_details ADD COLUMN math_fingerprint TEXT;
-- JSON count of media devices (cameras/mics) — no permission needed for counts.
ALTER TABLE serve_scan_details ADD COLUMN media_devices TEXT;
-- JSON AudioContext hardware properties (sampleRate, baseLatency, maxChannelCount).
ALTER TABLE serve_scan_details ADD COLUMN audio_context TEXT;
-- navigator.storage.estimate() quota — reveals device storage tier.
ALTER TABLE serve_scan_details ADD COLUMN storage_estimate TEXT;
-- Full navigator.languages array as JSON (more specific than single lang).
ALTER TABLE serve_scan_details ADD COLUMN languages TEXT;
-- Full Intl resolver config (locale, calendar, numbering, collation).
ALTER TABLE serve_scan_details ADD COLUMN intl_config TEXT;
-- Master forensic hash: SHA-256 of ALL stable signals combined. This is the
-- single identifier that ties a scan to a specific physical device. Changing
-- any one signal changes the hash, so spoofing requires matching ALL signals.
ALTER TABLE serve_scan_details ADD COLUMN forensic_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_serve_scan_details_forensic_hash
  ON serve_scan_details(forensic_hash)
  WHERE forensic_hash IS NOT NULL;
