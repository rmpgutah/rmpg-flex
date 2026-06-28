-- ============================================================
-- Migration 0021 — Panic Alerts + Officer Welfare watches
-- ============================================================
-- Backs src/routes/dispatch/panic.ts. WelfareWatchDO (added
-- in main earlier) handles the auto-prompt timer; this table
-- captures the panic_alert records the dispatcher reviews and
-- closes out.
-- ============================================================

CREATE TABLE IF NOT EXISTS panic_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  unit_id INTEGER,
  call_id INTEGER,
  latitude REAL,
  longitude REAL,
  location_address TEXT,
  source TEXT NOT NULL DEFAULT 'manual',  -- manual | radio | duress | auto | welfare
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
