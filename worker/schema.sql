CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- NOTE: this DDL is duplicated in migrations/0001_init.sql (test-only, used by
-- vitest-pool-workers' isolated Miniflare storage). If you change this file,
-- update migrations/0001_init.sql to match, and vice versa.
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'parts')),
  model TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  -- JSON-stringified OpenAI-style tool_calls array, set on assistant messages
  -- that requested tool calls. Required so history replayed to OpenRouter has
  -- an assistant tool_calls message preceding each role:'tool' result.
  tool_calls TEXT,
  created_at INTEGER NOT NULL
);
