-- Second pass on 0231's device/geo capture: protocol-level connection
-- detail (HTTP version, TLS version/cipher — free from Cloudflare's `cf`
-- object, same as the geo fields), a heuristic VPN/hosting-ASN flag, and
-- device-reported GPS coordinates (distinct from the IP-derived
-- latitude/longitude in 0231, which is Cloudflare's edge estimate of where
-- the connecting IP is, not where the device's GPS says it is). Device GPS
-- is opt-in at the browser's own permission prompt (navigator.geolocation)
-- and is only ever attached to an already-successful session — there is no
-- stable identifier to attach it to for a failed login attempt.

ALTER TABLE sessions ADD COLUMN http_protocol TEXT;
ALTER TABLE sessions ADD COLUMN tls_version TEXT;
ALTER TABLE sessions ADD COLUMN tls_cipher TEXT;
ALTER TABLE sessions ADD COLUMN likely_vpn_or_hosting INTEGER;
ALTER TABLE sessions ADD COLUMN device_latitude TEXT;
ALTER TABLE sessions ADD COLUMN device_longitude TEXT;
ALTER TABLE sessions ADD COLUMN device_geo_accuracy_m TEXT;
ALTER TABLE sessions ADD COLUMN device_geo_captured_at TEXT;
-- Sec-CH-UA-Platform / Sec-CH-UA-Platform-Version — low-entropy User-Agent
-- Client Hints most Chromium browsers send by default, with no Accept-CH
-- opt-in required. NOT a hardware make/model: Sec-CH-UA-Model is a
-- HIGH-entropy hint that Chromium only ever populates for mobile devices —
-- it comes back empty on every desktop/laptop browser regardless of the
-- server's headers, so "Panasonic Toughbook FZ-55" cannot be captured this
-- way. Real hardware make/model would need a native probe added to the
-- existing Electron desktop wrapper (desktop/), which is a separate feature.
ALTER TABLE sessions ADD COLUMN device_platform TEXT;
ALTER TABLE sessions ADD COLUMN device_platform_version TEXT;

ALTER TABLE login_attempts ADD COLUMN http_protocol TEXT;
ALTER TABLE login_attempts ADD COLUMN tls_version TEXT;
ALTER TABLE login_attempts ADD COLUMN tls_cipher TEXT;
ALTER TABLE login_attempts ADD COLUMN likely_vpn_or_hosting INTEGER;
ALTER TABLE login_attempts ADD COLUMN device_platform TEXT;
ALTER TABLE login_attempts ADD COLUMN device_platform_version TEXT;
