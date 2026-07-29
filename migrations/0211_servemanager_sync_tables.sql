-- ServeManager sync bookkeeping tables.
-- Mirrors migrations/0133_fleetio_sync_tables.sql (canonicalized shape from 0206),
-- applied directly rather than reusing the pre-canonicalization mistakes.

CREATE TABLE IF NOT EXISTS servemanager_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rmpg_table TEXT NOT NULL,
  rmpg_id INTEGER NOT NULL,
  servemanager_resource TEXT NOT NULL,
  servemanager_id INTEGER NOT NULL,
  last_pushed_at TEXT,
  last_pulled_at TEXT,
  pushed_checksum TEXT,
  pulled_checksum TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (rmpg_table, rmpg_id),
  UNIQUE (servemanager_resource, servemanager_id)
);

CREATE INDEX IF NOT EXISTS idx_servemanager_links_reverse
  ON servemanager_links (servemanager_resource, servemanager_id, rmpg_table);

CREATE TABLE IF NOT EXISTS servemanager_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  event_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id INTEGER,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  attempts INTEGER DEFAULT 0,
  payload_json TEXT NOT NULL,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT,
  UNIQUE (direction, event_id)
);

CREATE INDEX IF NOT EXISTS idx_servemanager_events_status ON servemanager_events (status, created_at);

CREATE TABLE IF NOT EXISTS servemanager_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rmpg_table TEXT NOT NULL,
  rmpg_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  local_value TEXT,
  remote_value TEXT,
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('local_wins', 'remote_wins', 'manual', 'unresolved')),
  resolved_by INTEGER,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_servemanager_conflicts_open
  ON servemanager_conflicts (rmpg_table, rmpg_id)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS servemanager_sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
