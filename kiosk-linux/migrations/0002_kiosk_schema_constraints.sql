-- kiosk-linux/migrations/0002_kiosk_schema_constraints.sql
--
-- SQLite does not support adding CHECK constraints to existing columns via
-- ALTER TABLE. Instead, recreate each table with the constraint and copy
-- the data. Both tables are small (device fleet only) so this is safe.
--
-- Adds:
--   kiosk_devices.status         CHECK (status IN ('active', 'revoked'))
--   kiosk_device_uploads.kind    CHECK (kind   IN ('config', 'log'))

-- ── kiosk_devices ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kiosk_devices_new (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  os_version    TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'revoked')),
  registered_at TEXT NOT NULL,
  last_seen_at  TEXT,
  last_ip       TEXT
);

INSERT OR IGNORE INTO kiosk_devices_new
  SELECT id, label, token_hash, os_version, status, registered_at, last_seen_at, last_ip
  FROM kiosk_devices
  WHERE status IN ('active', 'revoked');

DROP TABLE kiosk_devices;
ALTER TABLE kiosk_devices_new RENAME TO kiosk_devices;

-- ── kiosk_device_uploads ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS kiosk_device_uploads_new (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES kiosk_devices(id),
  kind        TEXT NOT NULL CHECK (kind IN ('config', 'log')),
  r2_key      TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL
);

INSERT OR IGNORE INTO kiosk_device_uploads_new
  SELECT id, device_id, kind, r2_key, size_bytes, uploaded_at
  FROM kiosk_device_uploads
  WHERE kind IN ('config', 'log');

DROP TABLE kiosk_device_uploads;
ALTER TABLE kiosk_device_uploads_new RENAME TO kiosk_device_uploads;

CREATE INDEX IF NOT EXISTS idx_kiosk_device_uploads_device
  ON kiosk_device_uploads(device_id);
