-- 0075_unit_trips.sql
-- Navigation trip logging. A "trip" is a lifecycle-bounded leg of a unit's
-- movement: CALL_RESPONSE (status enroute → onscene/cleared) or PATROL
-- (everything else that's moving; auto-closes after 5 min stationary).
-- Server-authoritative + immutable once closed (close_reason set) for audit.
-- See docs/plans/2026-06-03-navigation-trip-logging-design.md.
--
-- Apply to live D1 (785de7ae) via d1_database_query as well — the deploy
-- migration step is continue-on-error and the live schema is patched directly.
-- D1 has no IF NOT EXISTS on ADD COLUMN; re-applying the ALTER errors harmlessly.

CREATE TABLE IF NOT EXISTS unit_trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  officer_id INTEGER,
  vehicle_id INTEGER,
  trip_type TEXT NOT NULL CHECK (trip_type IN ('call_response','patrol')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  call_id INTEGER,
  call_number TEXT,
  call_type TEXT,
  prev_trip_id INTEGER,
  shift_session_id TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  close_reason TEXT,
  start_lat REAL, start_lng REAL,
  end_lat REAL, end_lng REAL,
  start_mileage REAL, end_mileage REAL,
  distance_m REAL NOT NULL DEFAULT 0,
  duration_s INTEGER,
  max_speed REAL NOT NULL DEFAULT 0,
  avg_speed REAL,
  max_lat_g REAL NOT NULL DEFAULT 0,
  harsh_accel_count INTEGER NOT NULL DEFAULT 0,
  harsh_brake_count INTEGER NOT NULL DEFAULT 0,
  harsh_corner_count INTEGER NOT NULL DEFAULT 0,
  stop_count INTEGER NOT NULL DEFAULT 0,
  idle_seconds INTEGER NOT NULL DEFAULT 0,
  anchor_lat REAL, anchor_lng REAL,
  last_move_at TEXT,
  last_fix_ts TEXT,
  speed_sum REAL NOT NULL DEFAULT 0,
  fix_count INTEGER NOT NULL DEFAULT 0,
  prev_bearing REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_unit_trips_unit_status ON unit_trips (unit_id, status);
CREATE INDEX IF NOT EXISTS idx_unit_trips_unit_start  ON unit_trips (unit_id, start_time);
CREATE INDEX IF NOT EXISTS idx_unit_trips_call        ON unit_trips (call_id);
CREATE INDEX IF NOT EXISTS idx_unit_trips_status      ON unit_trips (status);

ALTER TABLE gps_breadcrumbs ADD COLUMN trip_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_gps_breadcrumbs_trip ON gps_breadcrumbs (trip_id);
