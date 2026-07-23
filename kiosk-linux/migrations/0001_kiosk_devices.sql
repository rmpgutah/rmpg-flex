-- kiosk-linux/migrations/0001_kiosk_devices.sql
CREATE TABLE IF NOT EXISTS kiosk_devices (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  os_version    TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  registered_at TEXT NOT NULL,
  last_seen_at  TEXT,
  last_ip       TEXT
);

CREATE TABLE IF NOT EXISTS kiosk_device_uploads (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES kiosk_devices(id),
  kind        TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kiosk_device_uploads_device
  ON kiosk_device_uploads(device_id);
