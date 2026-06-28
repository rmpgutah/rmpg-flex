-- Email send outbox — durable queue for Graph /me/sendMail.
-- /api/email/send writes here first, then attempts Graph; on failure the
-- row stays 'pending' and the cron poller retries with exponential backoff.
-- Applied directly to live D1 on 2026-06-08; file is here for fresh DBs.

CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,
  payload TEXT NOT NULL,                       -- JSON Graph /me/sendMail body
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  status TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'sent' | 'failed'
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_pending ON email_outbox(status, next_attempt_at);
