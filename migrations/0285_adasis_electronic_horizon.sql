-- ============================================================
-- ADASIS v3 Electronic Horizon integration for RMPG Flex
-- ============================================================
-- Adds tables for:
--   1. Road segment profiles (curvature, gradient, speed, lanes)
--   2. Predicted paths (Most Preferred Path + alternatives)
--   3. Vehicle horizon state (current road context per unit)
--   4. Traffic signs and road furniture
--   5. Telematics hardware registry
--
-- All DDL is idempotent (CREATE TABLE IF NOT EXISTS).
-- Applied via: scripts/apply-migration.sh 0285_adasis_electronic_horizon.sql
-- ============================================================

-- ── Road segments with ADASIS profiles ─────────────────────
-- Each row is one road segment (typically one OSM way or a
-- portion thereof) with curvature, gradient, speed limit, and
-- lane data pre-computed for the Horizon Provider.
CREATE TABLE IF NOT EXISTS adasis_road_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id TEXT NOT NULL UNIQUE,
  osm_way_id INTEGER,
  road_name TEXT,
  road_class TEXT,
  form_of_way TEXT,
  speed_limit_kmh INTEGER,
  num_lanes INTEGER,
  lane_width_cm INTEGER,
  curvature_data TEXT,
  gradient_data TEXT,
  has_tunnel INTEGER DEFAULT 0,
  has_bridge INTEGER DEFAULT 0,
  has_toll INTEGER DEFAULT 0,
  jurisdiction TEXT,
  geometry_geojson TEXT,
  length_m REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_adasis_segments_osm ON adasis_road_segments(osm_way_id);
CREATE INDEX IF NOT EXISTS idx_adasis_segments_class ON adasis_road_segments(road_class);
CREATE INDEX IF NOT EXISTS idx_adasis_segments_jurisdiction ON adasis_road_segments(jurisdiction);

-- ── Predicted paths (MPP + alternatives) ──────────────────
-- The Horizon Provider computes a Most Preferred Path (MPP)
-- and optional alternative paths from a vehicle's current
-- position toward its destination.
CREATE TABLE IF NOT EXISTS adasis_predicted_paths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  path_id TEXT NOT NULL,
  is_mpp INTEGER NOT NULL DEFAULT 1,
  probability REAL DEFAULT 1.0,
  destination_lat REAL,
  destination_lng REAL,
  total_length_m REAL,
  segment_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_adasis_paths_vehicle ON adasis_predicted_paths(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_adasis_paths_unit ON adasis_predicted_paths(unit_id);
CREATE INDEX IF NOT EXISTS idx_adasis_paths_expires ON adasis_predicted_paths(expires_at);

-- ── Vehicle horizon state ─────────────────────────────────
-- The latest road-context snapshot for each vehicle, updated
-- by the Horizon Consumer (vehicle → RMPG) and read by the
-- dispatch map to show the "road ahead" preview.
CREATE TABLE IF NOT EXISTS adasis_vehicle_horizon (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL UNIQUE,
  unit_id INTEGER NOT NULL,
  position_lat REAL NOT NULL,
  position_lng REAL NOT NULL,
  heading REAL,
  speed_kmh REAL,
  current_segment_id TEXT,
  distance_to_next_curve_m REAL,
  next_curve_curvature REAL,
  distance_to_speed_change_m REAL,
  next_speed_limit INTEGER,
  distance_to_intersection_m REAL,
  jurisdiction_ahead TEXT,
  horizon_length_m REAL DEFAULT 5000,
  last_provider_update TEXT,
  last_consumer_update TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_adasis_horizon_vehicle ON adasis_vehicle_horizon(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_adasis_horizon_unit ON adasis_vehicle_horizon(unit_id);

-- ── Traffic signs and road furniture ──────────────────────
-- Signs anchored to segments by offset distance along the
-- road geometry. Used by the Provider to send sign data to
-- vehicles and by the dispatch map for regulatory overlays.
CREATE TABLE IF NOT EXISTS adasis_signs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id TEXT NOT NULL,
  offset_m REAL NOT NULL,
  sign_type TEXT NOT NULL,
  sign_value TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_adasis_signs_segment ON adasis_signs(segment_id);
CREATE INDEX IF NOT EXISTS idx_adasis_signs_type ON adasis_signs(sign_type);

-- ── Telematics hardware registry ──────────────────────────
-- Tracks which ADASIS-capable devices are installed in which
-- patrol vehicles and what protocol version they support.
CREATE TABLE IF NOT EXISTS adasis_telematics_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  device_type TEXT NOT NULL,
  device_serial TEXT UNIQUE,
  protocol_version TEXT DEFAULT 'v3',
  capabilities TEXT DEFAULT '{}',
  is_active INTEGER DEFAULT 1,
  registered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_adasis_devices_vehicle ON adasis_telematics_devices(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_adasis_devices_serial ON adasis_telematics_devices(device_serial);
