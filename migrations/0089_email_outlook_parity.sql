-- 0089: Outlook-parity email subsystem tables.
-- Idempotent (CREATE IF NOT EXISTS only — no ALTERs, see migrations/README.md).
--
-- email_templates       — reusable compose templates (TemplatePicker UI shipped in PR #1100)
-- email_scheduled       — schedule-send queue, drained by the per-minute cron
-- email_snoozes         — snoozed messages; cron resurfaces (moves back to inbox + unread)
-- email_blocked_senders — block list enforced at poll time (auto-move to Junk)

CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER,                 -- NULL = shared/org-wide
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_email_templates_owner ON email_templates(owner_user_id);

CREATE TABLE IF NOT EXISTS email_scheduled (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,
  to_addresses TEXT NOT NULL,            -- JSON array of strings
  cc_addresses TEXT,                     -- JSON array of strings
  bcc_addresses TEXT,                    -- JSON array of strings
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  is_html INTEGER NOT NULL DEFAULT 1,
  importance TEXT NOT NULL DEFAULT 'normal',
  attachments TEXT,                      -- JSON array of {name,contentType,contentBytes}
  scheduled_at TEXT NOT NULL,            -- localtime 'YYYY-MM-DDTHH:MM:SS'
  status TEXT NOT NULL DEFAULT 'pending',-- pending | sent | failed | cancelled
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_email_scheduled_due ON email_scheduled(status, scheduled_at);

CREATE TABLE IF NOT EXISTS email_snoozes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,
  message_graph_id TEXT NOT NULL,
  original_folder TEXT NOT NULL DEFAULT 'inbox',
  snooze_until TEXT NOT NULL,            -- localtime
  status TEXT NOT NULL DEFAULT 'snoozed',-- snoozed | resurfaced | cancelled
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(owner_user_id, message_graph_id)
);
CREATE INDEX IF NOT EXISTS idx_email_snoozes_due ON email_snoozes(status, snooze_until);

CREATE TABLE IF NOT EXISTS email_blocked_senders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,
  address TEXT NOT NULL,                 -- lowercased email or @domain
  reason TEXT,                           -- 'blocked' | 'junk-report' | 'phishing-report'
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(owner_user_id, address)
);
