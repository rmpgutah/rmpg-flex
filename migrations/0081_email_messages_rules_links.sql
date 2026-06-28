-- Microsoft 365 email — Phase 3 storage.
-- Cron poller populates email_messages from Graph; the rules engine
-- evaluates new messages and the autolinker drops cross-references
-- into email_links (CFS / person / etc.).
--
-- Live D1 note: email_rules already exists with the legacy
-- (conditions/actions JSON) shape, so this migration uses that schema
-- verbatim and does NOT add a discrete-column variant. The rules engine
-- in src/routes/email.ts parses the JSON columns at evaluation time.
-- All applied directly to live D1 on 2026-06-08; the file is here for
-- repeatability on fresh databases.

CREATE TABLE IF NOT EXISTS email_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,
  graph_id TEXT NOT NULL,
  conversation_id TEXT,
  folder_id TEXT,
  subject TEXT,
  from_address TEXT,
  from_name TEXT,
  to_addresses TEXT,                  -- JSON array
  cc_addresses TEXT,                  -- JSON array
  body_preview TEXT,
  body_html TEXT,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_flagged INTEGER NOT NULL DEFAULT 0,
  importance TEXT,
  categories TEXT,                    -- JSON array (rule tags + auto)
  received_at TEXT,
  sent_at TEXT,
  cached_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(owner_user_id, graph_id)
);

CREATE INDEX IF NOT EXISTS idx_email_messages_owner_received ON email_messages(owner_user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_folder ON email_messages(owner_user_id, folder_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_conv ON email_messages(conversation_id);

-- email_rules: legacy shape, kept verbatim on live D1.
--   conditions JSON: { from?: string, subject?: string, hasAttachment?: 0|1 }
--   actions    JSON: { markRead?: 1, flag?: 1, moveFolder?: string, categories?: string[] }
CREATE TABLE IF NOT EXISTS email_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  conditions TEXT NOT NULL,
  actions TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  owner_user_id INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS email_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_graph_id TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,          -- 'cfs' | 'person' | 'incident' | 'plate'
  entity_id INTEGER,                  -- internal row id when resolvable
  entity_ref TEXT,                    -- raw matched token (call_number, plate, name)
  source TEXT NOT NULL DEFAULT 'autolinker',  -- 'autolinker' | 'manual'
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by INTEGER,
  UNIQUE(message_graph_id, entity_type, entity_ref)
);

CREATE INDEX IF NOT EXISTS idx_email_links_msg ON email_links(message_graph_id);
CREATE INDEX IF NOT EXISTS idx_email_links_entity ON email_links(entity_type, entity_id);
