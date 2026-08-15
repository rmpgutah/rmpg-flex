-- migrations/0249_sync_queue.sql
-- Local-only: run on FZ-55 via `npm run migrate:local`. Do NOT apply to live D1.
CREATE TABLE IF NOT EXISTS sync_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  method        TEXT NOT NULL,
  path          TEXT NOT NULL,
  body          TEXT,
  headers       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_attempt  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status
  ON sync_queue(status, created_at);
