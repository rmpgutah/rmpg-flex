-- Driver Performance (spec 2026-08-01).
-- Attribution FK on assignments; attribution stamp on events; daily snapshots.

-- Time-correct attribution needs an officer FK. Existing rows carry only
-- free-text officer_name; a resolver backfills unambiguous matches later.
ALTER TABLE fleet_assignments ADD COLUMN officer_id INTEGER REFERENCES users(id);

-- Stamped at ingest going forward. 'recorded' | 'inferred' | 'unattributed'.
ALTER TABLE dashcam_events ADD COLUMN officer_id INTEGER REFERENCES users(id);
ALTER TABLE dashcam_events ADD COLUMN officer_attribution_source TEXT;

CREATE TABLE IF NOT EXISTS driver_performance_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL REFERENCES users(id),
  perf_date TEXT NOT NULL,

  miles_driven REAL NOT NULL DEFAULT 0,
  drive_minutes REAL NOT NULL DEFAULT 0,
  trip_count INTEGER NOT NULL DEFAULT 0,

  events_critical INTEGER NOT NULL DEFAULT 0,
  events_high INTEGER NOT NULL DEFAULT 0,
  events_moderate INTEGER NOT NULL DEFAULT 0,
  events_low INTEGER NOT NULL DEFAULT 0,

  events_forward_collision INTEGER NOT NULL DEFAULT 0,
  events_lane_departure INTEGER NOT NULL DEFAULT 0,
  events_close_following INTEGER NOT NULL DEFAULT 0,
  events_harsh_brake INTEGER NOT NULL DEFAULT 0,
  events_harsh_accel INTEGER NOT NULL DEFAULT 0,
  events_speeding INTEGER NOT NULL DEFAULT 0,

  attribution_recorded_pct REAL NOT NULL DEFAULT 0,
  attribution_inferred_pct REAL NOT NULL DEFAULT 0,

  fuel_cost REAL NOT NULL DEFAULT 0,
  fuel_gallons REAL NOT NULL DEFAULT 0,
  maintenance_cost REAL NOT NULL DEFAULT 0,
  damage_cost REAL NOT NULL DEFAULT 0,

  score REAL,
  score_version TEXT NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(officer_id, perf_date)
);

CREATE INDEX IF NOT EXISTS idx_dpd_date ON driver_performance_daily(perf_date);
CREATE INDEX IF NOT EXISTS idx_dpd_officer_date ON driver_performance_daily(officer_id, perf_date);
CREATE INDEX IF NOT EXISTS idx_fleet_assign_officer ON fleet_assignments(officer_id, assigned_at);
CREATE INDEX IF NOT EXISTS idx_dashcam_events_officer ON dashcam_events(officer_id, event_timestamp);
