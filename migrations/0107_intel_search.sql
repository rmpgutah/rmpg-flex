-- Intel Portal Phase 2: per-user saved searches + recent history.
CREATE TABLE IF NOT EXISTS intel_saved_searches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  query_text  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON intel_saved_searches(user_id);

CREATE TABLE IF NOT EXISTS intel_search_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  query_text  TEXT NOT NULL,
  executed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_history_user ON intel_search_history(user_id, executed_at);
