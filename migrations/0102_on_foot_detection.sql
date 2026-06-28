-- 0102: On-foot (walking) detection — CoreMotion activity on breadcrumbs,
-- orthogonal on-foot state on units, and per-segment logging.
-- D1 has no IF NOT EXISTS for ADD COLUMN; re-apply failures are expected
-- and reconciled by the boot reconciler (see migrations/README.md).

ALTER TABLE gps_breadcrumbs ADD COLUMN activity TEXT;
ALTER TABLE gps_breadcrumbs ADD COLUMN activity_confidence TEXT;

ALTER TABLE units ADD COLUMN on_foot INTEGER DEFAULT 0;
ALTER TABLE units ADD COLUMN on_foot_since TEXT;
ALTER TABLE units ADD COLUMN on_foot_source TEXT;
ALTER TABLE units ADD COLUMN on_foot_alerted INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS foot_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER,
  unit_id INTEGER,
  call_sign TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  start_lat REAL,
  start_lng REAL,
  end_lat REAL,
  end_lng REAL,
  duration_s INTEGER,
  distance_m REAL,
  peak_activity TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_foot_segments_officer ON foot_segments(officer_id);
CREATE INDEX IF NOT EXISTS idx_foot_segments_unit ON foot_segments(unit_id);
CREATE INDEX IF NOT EXISTS idx_foot_segments_started ON foot_segments(started_at);
