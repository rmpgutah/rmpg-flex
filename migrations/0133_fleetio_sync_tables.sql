-- Fleet.io integration bookkeeping. PR 1 of the 9-PR Fleet.io program.
-- Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md
-- All DDL idempotent; D1 deploy is best-effort (continue-on-error in
-- deploy.yml) so the route layer self-heals missing tables/columns at
-- runtime via columnExists() in PR 4. Apply DIRECTLY to live D1 785de7ae
-- after merge and verify via pragma_table_info — see [[project-d1-schema-drift-audit]].

CREATE TABLE IF NOT EXISTS fleetio_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rmpg_table TEXT NOT NULL,
  rmpg_id INTEGER NOT NULL,
  fleetio_resource TEXT NOT NULL,
  fleetio_id INTEGER NOT NULL,
  last_pushed_at TEXT,
  last_pulled_at TEXT,
  pushed_checksum TEXT,
  pulled_checksum TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetio_links_rmpg
  ON fleetio_links (rmpg_table, rmpg_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetio_links_fleetio
  ON fleetio_links (fleetio_resource, fleetio_id);

CREATE TABLE IF NOT EXISTS fleetio_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  event_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id INTEGER,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','skipped')),
  attempts INTEGER DEFAULT 0,
  payload_json TEXT NOT NULL,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetio_events_dedup
  ON fleetio_events (direction, event_id);
CREATE INDEX IF NOT EXISTS idx_fleetio_events_status
  ON fleetio_events (status, created_at);

CREATE TABLE IF NOT EXISTS fleetio_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rmpg_table TEXT NOT NULL,
  rmpg_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  local_value TEXT,
  remote_value TEXT,
  resolution TEXT
    CHECK (resolution IS NULL OR resolution IN ('local_wins','remote_wins','manual','unresolved')),
  resolved_by INTEGER,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fleetio_conflicts_unresolved
  ON fleetio_conflicts (rmpg_table, rmpg_id)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS fleetio_sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
