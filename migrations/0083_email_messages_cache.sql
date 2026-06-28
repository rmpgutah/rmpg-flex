-- Local mirror of Microsoft Graph messages — populated by the
-- delta-sync helper (src/utils/emailSync.ts), refreshed every 4h
-- via the existing scheduled handler. Read endpoints stay live-proxy
-- for now; flipping them to read from this cache is a separate change.
--
-- Idempotent CREATE only. Future column adds go in a new migration.
-- The `raw` column holds the full Graph message JSON for fields not
-- otherwise broken out — keeps schema additions cheap.

CREATE TABLE IF NOT EXISTS email_messages (
  graph_id            TEXT PRIMARY KEY,        -- Graph message.id (long base64-like)
  conversation_id     TEXT,                    -- Graph conversationId
  subject             TEXT NOT NULL DEFAULT '',
  from_address        TEXT,
  from_name           TEXT,
  to_addresses        TEXT,                    -- JSON array of {email, name}
  cc_addresses        TEXT,                    -- JSON array
  body_preview        TEXT,
  body_html           TEXT,                    -- nullable; large bodies skipped on initial sync
  has_attachments     INTEGER NOT NULL DEFAULT 0,
  is_read             INTEGER NOT NULL DEFAULT 0,
  is_flagged          INTEGER NOT NULL DEFAULT 0,
  importance          TEXT NOT NULL DEFAULT 'normal',
  received_at         TEXT,                    -- ISO8601 from receivedDateTime
  sent_at             TEXT,                    -- ISO8601 from sentDateTime
  folder_id           TEXT,                    -- Graph parentFolderId
  raw                 TEXT,                    -- full Graph JSON, optional
  cached_at           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at          TEXT                     -- soft delete via delta @removed
);

CREATE INDEX IF NOT EXISTS idx_email_messages_folder       ON email_messages(folder_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_received     ON email_messages(received_at);
CREATE INDEX IF NOT EXISTS idx_email_messages_conversation ON email_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_is_read      ON email_messages(is_read);
