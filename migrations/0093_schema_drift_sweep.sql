-- 0093_schema_drift_sweep.sql
-- System-wide D1_ERROR/SQLITE_ERROR sweep (2026-06-10). Everything in this
-- file was ALREADY APPLIED directly to the live DB (785de7ae…) via the D1
-- API; it is recorded here so fresh/local databases match live. All DDL is
-- idempotent EXCEPT the ALTERs (D1 has no IF NOT EXISTS on ADD COLUMN) —
-- they will error on re-apply against live, which deploy.yml tolerates
-- (continue-on-error) and the local DB needs.

-- ── Columns referenced by deployed Worker code that never had migrations ──
ALTER TABLE time_entries ADD COLUMN starting_mileage REAL;          -- mig 0084 never applied live
ALTER TABLE time_entries ADD COLUMN ending_mileage REAL;
ALTER TABLE time_entries ADD COLUMN total_miles REAL;
ALTER TABLE time_entries ADD COLUMN qr_token TEXT;                  -- mig 0085 never applied live
ALTER TABLE citation_violations ADD COLUMN violation_number INTEGER;
ALTER TABLE citation_violations ADD COLUMN statute_id INTEGER;
ALTER TABLE citation_violations ADD COLUMN statute_citation TEXT;
ALTER TABLE citation_violations ADD COLUMN violation_description TEXT;
ALTER TABLE citation_violations ADD COLUMN offense_level TEXT;
ALTER TABLE citation_violations ADD COLUMN speed_recorded REAL;
ALTER TABLE citation_violations ADD COLUMN speed_limit REAL;
ALTER TABLE citation_violations ADD COLUMN notes TEXT;
ALTER TABLE email_messages ADD COLUMN raw TEXT;
ALTER TABLE email_messages ADD COLUMN deleted_at TEXT;
ALTER TABLE court_events ADD COLUMN verdict TEXT;
ALTER TABLE users ADD COLUMN call_sign TEXT;
ALTER TABLE shift_plans ADD COLUMN active INTEGER DEFAULT 1;
ALTER TABLE equipment_checkout_log ADD COLUMN performed_by INTEGER;
ALTER TABLE forensic_cases ADD COLUMN archived_at TEXT;
ALTER TABLE fleet_driver_certs ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE fleet_driver_vehicle_training ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE fleet_fuel_anomalies ADD COLUMN score REAL;
ALTER TABLE fleet_procurement_orders ADD COLUMN status TEXT DEFAULT 'ordered';
ALTER TABLE fleet_procurement_orders ADD COLUMN actual_delivery TEXT;
ALTER TABLE fleet_vehicle_specs ADD COLUMN is_active INTEGER DEFAULT 1;

-- ── Tables referenced by Worker code that had no DDL anywhere ──
-- Shapes derived from the Worker SQL + the client TypeScript contracts
-- (useSubpoenaTracking.DiscoveryObligation, useInternalAffairs.PolicyAcknowledgement).

CREATE TABLE IF NOT EXISTS court_discovery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number TEXT,
  discovery_type TEXT,        -- body_camera | dash_camera | reports | witness_statements | lab_results | photographs | audio | expert_reports | other
  description TEXT,
  due_date TEXT,
  provided_date TEXT,
  provided_to TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | provided | overdue | not_applicable
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_court_discovery_due ON court_discovery(due_date);

CREATE TABLE IF NOT EXISTS policy_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id TEXT,
  policy_title TEXT,
  version TEXT,
  effective_date TEXT,
  user_id INTEGER,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- acknowledged | pending | overdue
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_policy_ack_due ON policy_acknowledgements(due_date);
CREATE INDEX IF NOT EXISTS idx_policy_ack_user ON policy_acknowledgements(user_id);

CREATE TABLE IF NOT EXISTS config_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by INTEGER,
  changed_by_username TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_config_audit_created ON config_audit_log(created_at);

CREATE TABLE IF NOT EXISTS forensic_analysis_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  case_type TEXT,
  steps_json TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS forensic_report_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  sections_json TEXT,
  body_template TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- audit.ts self-creates this lazily on the summarise path; created here so
-- the read path works on a fresh DB before the first summary run.
CREATE TABLE IF NOT EXISTS audit_daily_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL,
  action TEXT NOT NULL,
  entry_count INTEGER DEFAULT 0,
  unique_users INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_summaries_unique ON audit_daily_summaries(log_date, action);

-- ── Address search (geo.ts) — table + content-linked FTS5 + sync triggers ──
-- Empty until an address dataset is loaded (R2 MAP_DATA or county data load).
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY,
  full_add TEXT NOT NULL,
  city TEXT,
  zip TEXT,
  county TEXT,
  lat REAL,
  lng REAL
);
CREATE INDEX IF NOT EXISTS idx_addresses_latlng ON addresses(lat, lng);
CREATE VIRTUAL TABLE IF NOT EXISTS addresses_fts USING fts5(full_add, content='addresses', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS addresses_fts_ai AFTER INSERT ON addresses BEGIN
  INSERT INTO addresses_fts(rowid, full_add) VALUES (new.id, new.full_add);
END;
CREATE TRIGGER IF NOT EXISTS addresses_fts_ad AFTER DELETE ON addresses BEGIN
  INSERT INTO addresses_fts(addresses_fts, rowid, full_add) VALUES ('delete', old.id, old.full_add);
END;
CREATE TRIGGER IF NOT EXISTS addresses_fts_au AFTER UPDATE ON addresses BEGIN
  INSERT INTO addresses_fts(addresses_fts, rowid, full_add) VALUES ('delete', old.id, old.full_add);
  INSERT INTO addresses_fts(rowid, full_add) VALUES (new.id, new.full_add);
END;
