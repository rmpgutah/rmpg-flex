-- Persist generated attempt windows for serve_queue items so:
--   1. The dashboard calendar can query upcoming attempts across all active papers.
--   2. The per-minute cron can fire pre-event push notifications to dispatch
--      at a random time 30 min – 6 h before each attempt window opens.
--
-- notify_at is stored as "YYYY-MM-DDTHH:MM" in America/Denver local time so
-- D1 lexicographic comparison works without timezone math.

CREATE TABLE IF NOT EXISTS serve_attempt_schedules (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id            INTEGER NOT NULL,
  attempt_number      INTEGER NOT NULL,
  scheduled_date      TEXT    NOT NULL,   -- YYYY-MM-DD (Denver local)
  window_start        TEXT    NOT NULL,   -- HH:MM (Denver local)
  window_end          TEXT    NOT NULL,   -- HH:MM (Denver local)
  window_label        TEXT,              -- focus string from planner
  notify_at           TEXT    NOT NULL,   -- "YYYY-MM-DDTHH:MM" Denver local
  notify_before_secs  INTEGER NOT NULL,  -- random [1800, 21600]
  notified            INTEGER NOT NULL DEFAULT 0,
  dismissed           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sas_queue
  ON serve_attempt_schedules(queue_id);

CREATE INDEX IF NOT EXISTS idx_sas_notify
  ON serve_attempt_schedules(notify_at, notified, dismissed);
