-- ============================================================
-- Nav Trip Log — automatic vehicle trip logging for take-home
-- and patrol vehicles. Detects movement at/after login, filters
-- WiFi location jitter, and persists trips across app focus.
-- ============================================================

-- ── Take-home vehicle flag on fleet_vehicles ─────────────────
-- Marks vehicles assigned for officer take-home use.
ALTER TABLE fleet_vehicles ADD COLUMN take_home INTEGER NOT NULL DEFAULT 0;

-- ── Take-home vehicle assignment on users ────────────────────
-- Direct link: officer → their take-home vehicle.
ALTER TABLE users ADD COLUMN take_home_vehicle_id INTEGER REFERENCES fleet_vehicles(id);

-- ── nav_trip_log — auto-detected and manual vehicle trips ────
CREATE TABLE IF NOT EXISTS nav_trip_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL REFERENCES users(id),
  vehicle_id INTEGER REFERENCES fleet_vehicles(id),
  unit_id INTEGER REFERENCES units(id),
  -- Trip origin
  start_lat REAL NOT NULL,
  start_lng REAL NOT NULL,
  start_accuracy REAL,
  start_location TEXT,
  start_time TEXT NOT NULL,
  -- Trip destination
  end_lat REAL,
  end_lng REAL,
  end_accuracy REAL,
  end_location TEXT,
  end_time TEXT,
  -- Derived
  distance_miles REAL,
  max_speed_mph REAL,
  duration_seconds INTEGER,
  -- Route breadcrumbs (JSON array of {lat,lng,ts} points)
  route_points TEXT,
  -- Status: pending (movement detected, awaiting confirmation),
  -- active (confirmed trip in progress), completed (ended),
  -- cancelled (false-start, cleared per 3-min/200ft rule)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','active','completed','cancelled')),
  -- How the trip was started
  detected_by TEXT NOT NULL DEFAULT 'auto'
    CHECK(detected_by IN ('auto','manual')),
  -- Trip purpose (take-home, patrol, training, maintenance, other)
  purpose TEXT DEFAULT 'patrol',
  -- Metadata
  device_type TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_nav_trip_officer ON nav_trip_log(officer_id, status);
CREATE INDEX IF NOT EXISTS idx_nav_trip_vehicle ON nav_trip_log(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_nav_trip_unit ON nav_trip_log(unit_id, status);
CREATE INDEX IF NOT EXISTS idx_nav_trip_time ON nav_trip_log(start_time);
