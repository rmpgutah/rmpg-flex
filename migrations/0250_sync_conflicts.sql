-- migrations/0250_sync_conflicts.sql
-- Local-only: run on FZ-55 via `npm run migrate:local`. Do NOT apply to live D1.
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name       TEXT NOT NULL,
  record_id        INTEGER NOT NULL,
  fz55_value       TEXT NOT NULL,
  cloud_value      TEXT NOT NULL,
  fz55_updated_at  TEXT NOT NULL,
  cloud_updated_at TEXT NOT NULL,
  winning_source   TEXT NOT NULL,
  resolved_at      TEXT NOT NULL DEFAULT (datetime('now')),
  sync_queue_id    INTEGER REFERENCES sync_queue(id)
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_table_record
  ON sync_conflicts(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_resolved_at
  ON sync_conflicts(resolved_at);
