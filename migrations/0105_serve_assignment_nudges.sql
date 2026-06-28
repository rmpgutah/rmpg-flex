-- ============================================================
-- 0105_serve_assignment_nudges.sql
-- Phase 2: serve-job needs-attention nudges.
-- serve_nudges = dedup tracking (cron won't re-spam a job+condition);
-- serve_nudge_settings = editable thresholds (single row).
-- Assignment itself reuses serve_queue.officer_id + activity_log audit
-- (no serve_queue ALTER).
-- ============================================================

CREATE TABLE IF NOT EXISTS serve_nudges (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id   INTEGER NOT NULL,
  condition        TEXT NOT NULL,
  last_notified_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(serve_queue_id, condition)
);
CREATE INDEX IF NOT EXISTS idx_serve_nudges_job ON serve_nudges(serve_queue_id);

CREATE TABLE IF NOT EXISTS serve_nudge_settings (
  id                       INTEGER PRIMARY KEY CHECK(id = 1),
  approaching_hours        INTEGER NOT NULL DEFAULT 48,
  diligence_gap_days       INTEGER NOT NULL DEFAULT 3,
  unassigned_window_hours  INTEGER NOT NULL DEFAULT 72,
  renotify_hours           INTEGER NOT NULL DEFAULT 24,
  notify_supervisor_email  INTEGER NOT NULL DEFAULT 1,
  digest_sender_user_id    INTEGER,
  updated_at               TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by               INTEGER
);

INSERT OR IGNORE INTO serve_nudge_settings (id) VALUES (1);
