-- TEST-ONLY: mirrors ../schema.sql for vitest-pool-workers isolated storage. Not used by wrangler deploy.
-- Keep this file in sync with ../schema.sql — if one changes, update the other to match.

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'parts')),
  model TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  created_at INTEGER NOT NULL
);
