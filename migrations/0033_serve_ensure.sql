-- ============================================================
-- 0033_serve_ensure.sql
-- ============================================================
-- Idempotent guard for serve_queue / serve_attempts / serve_routes.
-- Migration 0030_serve_intake.sql creates these — this migration is
-- a no-op if 0030 ran first, or a fallback if 0030 was lost to D1's
-- dirty-schema state. Lets the `serve` route file land independently
-- of the `serveIntake` PR ordering.
-- ============================================================

CREATE TABLE IF NOT EXISTS serve_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER,
  sm_job_id INTEGER,
  officer_id INTEGER,
  serve_date TEXT,
  recipient_name TEXT,
  recipient_person_id INTEGER,
  recipient_address TEXT,
  recipient_city TEXT,
  recipient_state TEXT,
  recipient_zip TEXT,
  recipient_lat REAL,
  recipient_lng REAL,
  property_id INTEGER,
  document_type TEXT,
  case_number TEXT,
  court_name TEXT,
  jurisdiction TEXT,
  client_name TEXT,
  attorney_name TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  time_window TEXT,
  deadline TEXT,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  service_instructions TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS serve_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  attempt_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  officer_id INTEGER,
  result TEXT,
  latitude REAL,
  longitude REAL,
  notes TEXT,
  attempt_type TEXT,
  photo_ids TEXT DEFAULT '[]',
  signature_data TEXT,
  planned_at TEXT,
  window TEXT,
  status TEXT DEFAULT 'attempted',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS serve_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  route_date TEXT,
  optimized_order_json TEXT DEFAULT '[]',
  waypoints_json TEXT DEFAULT '[]',
  total_distance_miles REAL,
  total_time_minutes REAL,
  start_lat REAL,
  start_lng REAL,
  end_lat REAL,
  end_lng REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_serve_queue_status ON serve_queue(status);
CREATE INDEX IF NOT EXISTS idx_serve_queue_officer ON serve_queue(officer_id);
CREATE INDEX IF NOT EXISTS idx_serve_queue_deadline ON serve_queue(deadline);
CREATE INDEX IF NOT EXISTS idx_serve_attempts_queue ON serve_attempts(serve_queue_id);
CREATE INDEX IF NOT EXISTS idx_serve_routes_officer ON serve_routes(officer_id);
CREATE INDEX IF NOT EXISTS idx_serve_routes_date ON serve_routes(route_date);
