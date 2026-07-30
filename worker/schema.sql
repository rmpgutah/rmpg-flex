-- NOTE: this DDL is duplicated in migrations/0001_init.sql for the vitest-pool-workers test
-- environment (which needs a numbered migration file, not an ad-hoc schema file). If you change
-- this file, update migrations/0001_init.sql to match, and vice versa.

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL
);
