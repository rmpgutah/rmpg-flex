-- Migration: Add serve_attempt_schedules for auto-replan + cron sweep
-- Timestamp: 2026-06-15
-- Depends: serve_queue (FK), alerting (alert_hub for notifications)
-- 
-- Persists dated attempt windows produced by serveDiligencePlanner for:
-- 1. Calendar display (serve intake dashboard & attempt history)
-- 2. Per-minute cron sweep that fires pre-event dispatch alerts
-- 3. Auto-replan on failed attempt (incremental slot append)
--
-- notify_at is stored as "YYYY-MM-DDTHH:MM" in America/Denver local time.
-- D1 lexicographic comparison on that format is always correct because
-- YYYY-MM-DDTHH:MM sorts identically to epoch ordering within a timezone.

CREATE TABLE IF NOT EXISTS serve_attempt_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER NOT NULL UNIQUE,
  attempt_number INTEGER NOT NULL,
  scheduled_date TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  window_label TEXT,
  notify_at TEXT NOT NULL,
  notify_before_secs INTEGER DEFAULT 1800,
  notified INTEGER DEFAULT 0,
  dismissed INTEGER DEFAULT 0,
  auto_replan_source INTEGER,
  disposition_code TEXT,
  created_at TEXT DEFAULT datetime('now','localtime'),
  updated_at TEXT DEFAULT datetime('now','localtime'),
  
  FOREIGN KEY (queue_id) REFERENCES serve_queue(id) ON DELETE CASCADE,
  FOREIGN KEY (auto_replan_source) REFERENCES serve_attempt_schedules(id) ON DELETE SET NULL,
  CHECK (attempt_number > 0),
  CHECK (notified IN (0,1)),
  CHECK (dismissed IN (0,1))
);

CREATE INDEX IF NOT EXISTS idx_serve_attempt_notify_due 
  ON serve_attempt_schedules(notify_at, notified, dismissed);

CREATE INDEX IF NOT EXISTS idx_serve_attempt_by_queue 
  ON serve_attempt_schedules(queue_id, scheduled_date);

CREATE TABLE IF NOT EXISTS cron_sweep_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sweep_name TEXT NOT NULL,
  last_run_at TEXT NOT NULL,
  duration_ms INTEGER,
  items_processed INTEGER DEFAULT 0,
  items_alerted INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT DEFAULT datetime('now','localtime'),
  
  CHECK (duration_ms >= 0),
  CHECK (items_processed >= 0)
);

CREATE INDEX IF NOT EXISTS idx_cron_sweep_name_date 
  ON cron_sweep_metrics(sweep_name, last_run_at DESC);
