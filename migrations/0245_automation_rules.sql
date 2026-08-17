-- migrations/0245_automation_rules.sql
CREATE TABLE IF NOT EXISTS automation_rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  description     TEXT,
  created_by      INTEGER REFERENCES users(id),
  scope           TEXT NOT NULL DEFAULT 'global',
  scope_id        INTEGER,
  enabled         INTEGER NOT NULL DEFAULT 1,
  trigger_type    TEXT NOT NULL,
  trigger_config  TEXT NOT NULL DEFAULT '{}',
  action_type     TEXT NOT NULL,
  action_config   TEXT NOT NULL DEFAULT '{}',
  dedup_window_ms INTEGER NOT NULL DEFAULT 300000,
  evaluate_client INTEGER NOT NULL DEFAULT 1,
  evaluate_server INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_automation_rules_scope
  ON automation_rules(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled
  ON automation_rules(enabled);
