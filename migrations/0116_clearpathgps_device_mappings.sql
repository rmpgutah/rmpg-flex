-- ClearPath → ALPR pipeline, Phase A: camera ↔ dispatch-unit mappings.
-- cpg_device_mappings does not exist on live D1 (verified 2026-06-14).
-- Idempotent; the clearpathgps route also reconciles this at boot.

CREATE TABLE IF NOT EXISTS cpg_device_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cpg_device_id TEXT NOT NULL,
  cpg_display_name TEXT,
  cpg_serial_number TEXT,
  cpg_camera_id INTEGER,            -- numeric v2.0 media camera id (resolved/cached in Phase B)
  unit_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_media_synced_at TEXT,        -- used by Phase B
  media_sync_errors INTEGER DEFAULT 0,
  vehicle_make TEXT, vehicle_model TEXT, vehicle_vin TEXT,
  license_plate TEXT, ignition_state TEXT, driver_name TEXT,
  last_odometer REAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cpg_map_device ON cpg_device_mappings(cpg_device_id);
CREATE INDEX IF NOT EXISTS idx_cpg_map_unit ON cpg_device_mappings(unit_id);
