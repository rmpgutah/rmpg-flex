-- Corporate ops linkage: mileage / time / workflow runs that join
-- Fleet, Time Clock, HR, Dispatch, Map GPS, and Process Server.
-- Column ALTERs for existing tables are applied by ensureCorporateOpsSchema
-- (D1 has no ADD COLUMN IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS corporate_ops_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  triggered_by INTEGER,
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  summary_json TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_corporate_ops_runs_kind_started
  ON corporate_ops_runs(kind, started_at DESC);

CREATE TABLE IF NOT EXISTS corporate_ops_run_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  officer_id INTEGER,
  summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES corporate_ops_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_corporate_ops_run_items_run
  ON corporate_ops_run_items(run_id);

CREATE TABLE IF NOT EXISTS corporate_mileage_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  time_entry_id INTEGER,
  vehicle_id INTEGER,
  unit_id INTEGER,
  duty_miles REAL NOT NULL DEFAULT 0,
  gps_trip_miles REAL NOT NULL DEFAULT 0,
  serve_billed_miles REAL NOT NULL DEFAULT 0,
  cfs_miles REAL NOT NULL DEFAULT 0,
  variance_miles REAL NOT NULL DEFAULT 0,
  flag TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(officer_id, work_date, time_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_corporate_mileage_links_date
  ON corporate_mileage_links(work_date, officer_id);
