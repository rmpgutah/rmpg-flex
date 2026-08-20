-- Migration 0238: Per-job internal comment thread for Process Server module
-- Supports: in-context notes between officers, system-generated streak/escalation alerts,
--           and supervisor annotations — all linked to a serve_queue row.
--
-- Intentionally a separate table (not a column on serve_queue) because:
--   1. serve_queue is already at 103 columns, past D1's 100-col SELECT cap
--   2. comment threads are unbounded in length and count
--   3. independent index/query path needed for per-job comment feeds

CREATE TABLE IF NOT EXISTS serve_job_comments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER NOT NULL REFERENCES serve_queue(id) ON DELETE CASCADE,
  author_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name    TEXT    NOT NULL DEFAULT 'System',
  author_role    TEXT,
  body           TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  edited_at      TEXT,
  is_system      INTEGER NOT NULL DEFAULT 0,    -- 1 = auto-generated (streak alert, escalation, etc.)
  parent_id      INTEGER REFERENCES serve_job_comments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sjc_queue_time   ON serve_job_comments(serve_queue_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sjc_author       ON serve_job_comments(author_id) WHERE author_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sjc_system       ON serve_job_comments(is_system, created_at) WHERE is_system = 1;
