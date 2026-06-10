-- Smart links + AI categorization + scheduled-send tables.
-- Idempotent CREATE only. No ALTERs.
--
-- email_rules already exists in baseline (id/name/conditions/actions/is_active/
-- created_at/owner_user_id/updated_at) — not recreated here; rule_matches is
-- added so the evaluator can record which inbound msg matched which rule.

-- ─── Smart links: bind a Graph email to incident/call/warrant/person ──
CREATE TABLE IF NOT EXISTS email_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email_graph_id  TEXT NOT NULL,
  incident_id     INTEGER,
  call_id         INTEGER,
  warrant_id      INTEGER,
  person_id       INTEGER,
  link_type       TEXT NOT NULL DEFAULT 'related',  -- related | evidence | notification | correspondence
  notes           TEXT,
  linked_by       INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_email_links_graph_id ON email_links(email_graph_id);
CREATE INDEX IF NOT EXISTS idx_email_links_incident ON email_links(incident_id);
CREATE INDEX IF NOT EXISTS idx_email_links_call     ON email_links(call_id);
CREATE INDEX IF NOT EXISTS idx_email_links_warrant  ON email_links(warrant_id);
CREATE INDEX IF NOT EXISTS idx_email_links_person   ON email_links(person_id);

-- ─── AI categorization output ────────────────────────────────────────
-- One row per Graph message. graph_id is the FK to email_messages (no
-- FK constraint to keep the categorize endpoint usable even when sync
-- hasn't populated the message row yet — we just upsert).
CREATE TABLE IF NOT EXISTS email_categories (
  graph_id        TEXT PRIMARY KEY,
  category        TEXT NOT NULL,
  confidence      REAL,
  model           TEXT,
  categorized_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_email_categories_category ON email_categories(category);

-- ─── Scheduled (deferred) sends ──────────────────────────────────────
-- The per-minute cron scans this table for rows where status='queued'
-- AND scheduled_for <= now(). max_attempts caps retries to keep one
-- bad Graph response from looping forever.
CREATE TABLE IF NOT EXISTS scheduled_emails (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id       INTEGER,
  sender_username TEXT,
  to_addresses    TEXT NOT NULL,            -- JSON array of {email,name}
  cc_addresses    TEXT,                     -- JSON array
  bcc_addresses   TEXT,                     -- JSON array
  subject         TEXT NOT NULL DEFAULT '',
  body_html       TEXT,
  body_text       TEXT,
  scheduled_for   TEXT NOT NULL,            -- ISO8601 UTC
  status          TEXT NOT NULL DEFAULT 'queued',  -- queued | sent | failed | cancelled
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  last_error      TEXT,
  graph_message_id TEXT,
  sent_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_emails_status_due ON scheduled_emails(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_sender    ON scheduled_emails(sender_id);

-- ─── Rule-match audit (companion to existing email_rules) ────────────
CREATE TABLE IF NOT EXISTS email_rule_matches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id         INTEGER NOT NULL,
  email_graph_id  TEXT NOT NULL,
  matched_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_email_rule_matches_rule  ON email_rule_matches(rule_id);
CREATE INDEX IF NOT EXISTS idx_email_rule_matches_email ON email_rule_matches(email_graph_id);
