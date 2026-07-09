-- ============================================================
-- Widen geofence_zones.zone_type to include 'station' and
-- nav_trip_log.status to include 'paused'.
--
-- Enables station-geofence auto pause/resume of active nav trips:
-- when a unit's live GPS enters a 'station'-type geofence zone,
-- the active trip is paused; on exit, it is resumed.
--
-- SQLite has no ALTER TABLE ... DROP/ADD CONSTRAINT, so both
-- tables are recreated with the widened CHECK and data copied.
-- ============================================================

-- ── geofence_zones: add 'station' to zone_type CHECK ────────
CREATE TABLE IF NOT EXISTS geofence_zones_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_name     TEXT NOT NULL,
  zone_type     TEXT CHECK(zone_type IN ('exclusion','inclusion','alert','patrol_required','station')),
  geojson_data  TEXT NOT NULL,
  description   TEXT,
  color         TEXT DEFAULT '#d4a017',
  is_active     INTEGER DEFAULT 1,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

INSERT INTO geofence_zones_new (id, zone_name, zone_type, geojson_data, description, color, is_active, created_by, created_at, updated_at)
SELECT id, zone_name, zone_type, geojson_data, description, color, is_active, created_by, created_at, updated_at
FROM geofence_zones;

DROP TABLE IF EXISTS geofence_zones;
ALTER TABLE geofence_zones_new RENAME TO geofence_zones;

-- ── nav_trip_log: add 'paused' to status CHECK ───────────────
CREATE TABLE IF NOT EXISTS nav_trip_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL REFERENCES users(id),
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  unit_id INTEGER REFERENCES units(id),
  start_lat REAL NOT NULL,
  start_lng REAL NOT NULL,
  start_accuracy REAL,
  start_location TEXT,
  start_time TEXT NOT NULL,
  end_lat REAL,
  end_lng REAL,
  end_accuracy REAL,
  end_location TEXT,
  end_time TEXT,
  distance_miles REAL,
  max_speed_mph REAL,
  duration_seconds INTEGER,
  route_points TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','active','completed','cancelled','paused')),
  detected_by TEXT NOT NULL DEFAULT 'auto'
    CHECK(detected_by IN ('auto','manual')),
  purpose TEXT DEFAULT 'patrol',
  device_type TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

INSERT INTO nav_trip_log_new (
  id, officer_id, vehicle_id, unit_id,
  start_lat, start_lng, start_accuracy, start_location, start_time,
  end_lat, end_lng, end_accuracy, end_location, end_time,
  distance_miles, max_speed_mph, duration_seconds, route_points,
  status, detected_by, purpose, device_type, notes, created_at, updated_at
)
SELECT
  id, officer_id, vehicle_id, unit_id,
  start_lat, start_lng, start_accuracy, start_location, start_time,
  end_lat, end_lng, end_accuracy, end_location, end_time,
  distance_miles, max_speed_mph, duration_seconds, route_points,
  status, detected_by, purpose, device_type, notes, created_at, updated_at
FROM nav_trip_log;

DROP TABLE IF EXISTS nav_trip_log;
ALTER TABLE nav_trip_log_new RENAME TO nav_trip_log;

CREATE INDEX IF NOT EXISTS idx_nav_trip_officer ON nav_trip_log(officer_id, status);
CREATE INDEX IF NOT EXISTS idx_nav_trip_vehicle ON nav_trip_log(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_nav_trip_unit ON nav_trip_log(unit_id, status);
CREATE INDEX IF NOT EXISTS idx_nav_trip_time ON nav_trip_log(start_time);
