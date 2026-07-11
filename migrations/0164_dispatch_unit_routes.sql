-- 0164: dispatch_unit_routes — persisted multi-stop CFS routes built by the
-- Route Builder (/route-builder → /api/dispatch/routing). One row per built
-- route; superseded/completed rows are kept for shift review.
-- Idempotent; the routing route also reconciles this table at first use.
CREATE TABLE IF NOT EXISTS dispatch_unit_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL,
  origin_lat REAL,
  origin_lng REAL,
  waypoints_json TEXT NOT NULL DEFAULT '[]',
  optimized_order_json TEXT NOT NULL DEFAULT '[]',
  total_distance_miles REAL DEFAULT 0,
  estimated_time_minutes INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dispatch_unit_routes_unit
  ON dispatch_unit_routes(unit_id, status);
