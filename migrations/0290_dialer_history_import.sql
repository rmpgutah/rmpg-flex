-- Dial Connect history import (docs/superpowers/specs/2026-09-14-dial-connect-history-import-design.md)
-- Every imported row keeps its dispatch-app id so re-runs upsert instead of duplicating.
-- D1 has no ADD COLUMN IF NOT EXISTS; src/routes/dialerConnectImport.ts reconciles the
-- two ALTERs at runtime via columnExists(), so a re-apply failing here is harmless.

ALTER TABLE dialer_calls ADD COLUMN dispatch_app_id TEXT;
ALTER TABLE dialer_voicemails ADD COLUMN dispatch_app_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_calls_dispatch_app_id
  ON dialer_calls(dispatch_app_id) WHERE dispatch_app_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_voicemails_dispatch_app_id
  ON dialer_voicemails(dispatch_app_id) WHERE dispatch_app_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS dialer_callbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_app_id TEXT UNIQUE,
  phone_number TEXT NOT NULL,
  note TEXT,
  scheduled_for TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_by_name TEXT,
  incident_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dialer_callbacks_due ON dialer_callbacks(completed, scheduled_for);

CREATE TABLE IF NOT EXISTS dialer_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_app_id TEXT UNIQUE,
  name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  owner_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dialer_sms_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_app_id TEXT UNIQUE,
  phone_number TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dialer_sms_conversations_phone ON dialer_sms_conversations(phone_number);

CREATE TABLE IF NOT EXISTS dialer_sms_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_app_id TEXT UNIQUE,
  conversation_id INTEGER NOT NULL REFERENCES dialer_sms_conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  body TEXT NOT NULL,
  twilio_sid TEXT,
  status TEXT,
  sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dialer_sms_messages_conv ON dialer_sms_messages(conversation_id, sent_at);
