-- migrations/0246_automation_rule_firings.sql
CREATE TABLE IF NOT EXISTS automation_rule_firings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id     INTEGER NOT NULL REFERENCES automation_rules(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  unit_id     INTEGER,
  fired_at    TEXT NOT NULL DEFAULT (datetime('now')),
  trigger_lat REAL,
  trigger_lng REAL,
  context     TEXT DEFAULT '{}',
  source      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_arf_rule_user
  ON automation_rule_firings(rule_id, user_id, fired_at);
CREATE INDEX IF NOT EXISTS idx_arf_fired_at
  ON automation_rule_firings(fired_at);
