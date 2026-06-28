-- Migration 0006: Add integration_api_keys table and archived_at column to properties
-- The integration_api_keys table is referenced by integrations-worker.ts endpoints
-- but was never created in any migration or DDL statement.

CREATE TABLE IF NOT EXISTS integration_api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  scopes TEXT NOT NULL DEFAULT '["service_request"]',
  last_used_at TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_integration_api_keys_active ON integration_api_keys(is_active);

-- Add archived_at column to properties table (referenced by records-worker.ts)
ALTER TABLE properties ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS idx_properties_archived ON properties(archived_at);
