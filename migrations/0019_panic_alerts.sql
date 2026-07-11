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

-- system_config is the shared key/value bag the panic + welfare engines
-- were meant to read tunable seconds from. REMOVED 2026-07-03: two
-- competing 0001 migrations both declare this table with different
-- schemas (0001_initial.sql = key/value; 0001_initial_schema.sql =
-- config_key/config_value/category/sort_order/is_active), and whichever's
-- CREATE TABLE IF NOT EXISTS runs first on a given DB wins — live D1 has
-- the config_key/config_value version, but a fresh local DB (migrations
-- apply in filename order, and "0001_initial.sql" sorts before
-- "0001_initial_schema.sql") gets the OPPOSITE one. The seed INSERT
-- below used to hardcode (key, value) column names, which crashed with
-- "no such column: key" on live and silently rolled back this ENTIRE
-- migration file — wrangler runs each file in one transaction, so
-- officer_welfare (above) never got created either despite this file
-- showing as tracked/applied. Neither src/routes/dispatch/panic.ts nor
-- welfare.ts actually reads these config keys (grepped — no matches), so
-- rather than gamble on which schema wins in which environment, the seed
-- is dropped entirely. officer_welfare was created standalone directly
-- against live D1 as part of the same fix.
