-- Dispatcher Command Engine audit log (docs/superpowers/specs/2026-09-14-dispatcher-command-engine-design.md).
-- One row per natural-language / voice command the engine planned. The plan is
-- executed client-side against the normal routes (which write audit_log as
-- usual); this table records the INTERPRETATION so a mis-heard command can be
-- traced back to its transcript, planner, and provider.
-- Idempotent; also reconciled at runtime by src/routes/dispatcherCommand.ts.

CREATE TABLE IF NOT EXISTS dispatcher_command_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  source TEXT NOT NULL DEFAULT 'typed',          -- typed | speech
  input_text TEXT NOT NULL,
  intent TEXT,
  planner TEXT,                                  -- rules | ai | none
  provider TEXT,                                 -- claude | openai | workers-ai
  model TEXT,
  plan_json TEXT,                                -- steps as returned to the client
  status TEXT NOT NULL DEFAULT 'planned',        -- planned | awaiting_confirmation | confirmed | executed | partial | failed | cancelled | clarify | chatter
  results_json TEXT,                             -- client-reported per-step outcomes
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dispatcher_command_log_created ON dispatcher_command_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatcher_command_log_user ON dispatcher_command_log(user_id, created_at DESC);
