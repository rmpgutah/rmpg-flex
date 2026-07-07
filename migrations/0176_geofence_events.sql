-- migrations/0176_geofence_events.sql
CREATE TABLE IF NOT EXISTS unit_geofence_state (
  unit_id     INTEGER PRIMARY KEY,
  zone_id     INTEGER NOT NULL,
  entered_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS geofence_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id     INTEGER NOT NULL,
  zone_id     INTEGER NOT NULL,
  event_type  TEXT NOT NULL CHECK(event_type IN ('enter','exit')),
  latitude    REAL,
  longitude   REAL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_geofence_events_unit ON geofence_events(unit_id, created_at);
CREATE INDEX IF NOT EXISTS idx_geofence_events_zone ON geofence_events(zone_id, created_at);
