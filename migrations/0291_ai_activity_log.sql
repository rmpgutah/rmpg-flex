-- ============================================================
-- 0291: AI activity log + Dev Chat persistence
-- ============================================================
-- Backs three endpoints in src/routes/ai.ts that previously returned
-- hardcoded stubs, so their admin panels rendered permanently empty:
--   GET /ai/stats            -> all zeros      (AdminAISettingsTab)
--   GET /ai/activity         -> []             (AIActivityPanel, AICommandCenterPanel)
--   GET /ai/dev-chat/history -> []             (AIDevChatPanel)
--
-- ai_activity_log is written fire-and-forget by every AI endpoint via
-- logAiActivity() in src/utils/aiActivity.ts. A logging failure must never
-- fail the officer's AI request, so every write there is try/caught.
--
-- NOTE: no ALTER against calls_for_service / persons — both sit at or near
-- D1's hard 100-column cap. These are new tables only.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'workers-ai',
  model TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  prompt_preview TEXT,
  error TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_activity_log_created ON ai_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_activity_log_task ON ai_activity_log(task_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_activity_log_status ON ai_activity_log(status, created_at DESC);

-- Dev Chat sessions. session_key is the client-generated id the panel already
-- sends as `sessionId`; UNIQUE so a resumed conversation appends rather than
-- forking a second session row.
CREATE TABLE IF NOT EXISTS ai_dev_chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL UNIQUE,
  user_id INTEGER,
  title TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_dev_chat_sessions_user ON ai_dev_chat_sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_dev_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  provider TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_dev_chat_messages_session ON ai_dev_chat_messages(session_id, id);
