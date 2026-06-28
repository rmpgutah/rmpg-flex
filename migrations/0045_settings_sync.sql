-- 0045_settings_sync.sql
-- Per-user + org-wide settings blobs for cross-device sync and org defaults.
-- Settings are an opaque JSON object of client preference keys (voice, tones,
-- map, ptt). Precedence applied client-side: org defaults < user < local edit.
-- Idempotent: safe to re-apply against the dirty prod schema.

CREATE TABLE IF NOT EXISTS user_settings (
  user_id       INTEGER PRIMARY KEY,
  settings_json TEXT    NOT NULL DEFAULT '{}',
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS org_settings (
  id            INTEGER PRIMARY KEY,   -- singleton row, id = 1
  settings_json TEXT    NOT NULL DEFAULT '{}',
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Seed the singleton org-defaults row (empty until an admin saves one).
INSERT OR IGNORE INTO org_settings (id, settings_json) VALUES (1, '{}');
