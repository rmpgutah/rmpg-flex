-- Email integration tables — added with the Microsoft Graph wiring.
-- Idempotent: D1 supports CREATE TABLE IF NOT EXISTS but not ADD COLUMN IF NOT EXISTS,
-- so this file MUST stay a pure CREATE script. Future column adds go in a new file.

-- Reusable email templates surfaced in EmailPage's compose drawer.
-- Org-wide visibility (no scoping column) — templates are a small,
-- collaborative set, not per-user. created_by is informational.
CREATE TABLE IF NOT EXISTS email_templates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  subject         TEXT NOT NULL DEFAULT '',
  body_html       TEXT NOT NULL DEFAULT '',
  category        TEXT,
  created_by      INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);

-- Outbound mail audit. Every /api/email/send writes a row here on
-- success OR failure. Police records environment — "did dispatch ever
-- email the chief about X?" must be answerable at the DB.
CREATE TABLE IF NOT EXISTS email_audit_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  sent_by             INTEGER,           -- users.id
  sent_by_username    TEXT,              -- snapshot in case user is later deleted
  to_addresses        TEXT NOT NULL,     -- JSON array
  cc_addresses        TEXT,              -- JSON array, nullable
  subject             TEXT NOT NULL DEFAULT '',
  template_id         INTEGER,           -- email_templates.id if a template was used
  graph_message_id    TEXT,              -- Graph "internetMessageId" or "id" if returned
  status              TEXT NOT NULL DEFAULT 'sent',  -- 'sent' | 'failed'
  error               TEXT,              -- failure detail, nullable
  sent_at             TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_email_audit_sent_by ON email_audit_log(sent_by);
CREATE INDEX IF NOT EXISTS idx_email_audit_sent_at ON email_audit_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_audit_status ON email_audit_log(status);
