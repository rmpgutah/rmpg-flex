-- ============================================================
-- Migration 0019 — Panic Alerts + Officer Welfare watches
-- ============================================================
-- Backs src/routes/dispatch/panic.ts and welfare.ts. Escalation
-- timers run in-process on the legacy Express server; on Workers
-- they are deferred to a Durable Object Alarm (follow-up).
-- ============================================================

CREATE TABLE IF NOT EXISTS panic_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  unit_id INTEGER,
  call_id INTEGER,
  latitude REAL,
  longitude REAL,
  location_address TEXT,
  source TEXT NOT NULL DEFAULT 'manual',  -- manual | radio | duress | auto
  status TEXT NOT NULL DEFAULT 'active',  -- active | acknowledged | resolved | cancelled | false_alarm
  escalation_level INTEGER NOT NULL DEFAULT 0,
  acknowledged_by INTEGER,
  acknowledged_at TEXT,
  resolved_by INTEGER,
  resolved_at TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_panic_status ON panic_alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_panic_user ON panic_alerts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS officer_welfare (
  user_id INTEGER PRIMARY KEY,
  last_activity_at TEXT NOT NULL,
  last_ack_at TEXT,
  watch_started_at TEXT,
  status TEXT NOT NULL DEFAULT 'normal'   -- normal | prompted | overdue | emergency
);

-- system_config is the shared key/value bag the panic + welfare
-- engines read tunable seconds from. Pre-existing schema uses
-- (key, value) column names — keep this consistent so the legacy
-- table doesn't need a column rewrite.
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO system_config (key, value) VALUES
  ('panic_escalation_1_seconds', '30'),
  ('panic_escalation_2_seconds', '60'),
  ('panic_escalation_3_seconds', '90'),
  ('welfare_prompt_seconds', '900'),       -- 15 min idle → prompt
  ('welfare_overdue_seconds', '1200');     -- 20 min idle → overdue/emergency
