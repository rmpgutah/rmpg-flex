-- Generic D1-backed form-draft persistence ("filler" data-entry autosave).
-- One row per (user, form_id, entity_id) in-progress edit. Drafts survive
-- reloads/device switches and are only deleted after the real record is
-- confirmed saved — never wiped on a failed save.
CREATE TABLE IF NOT EXISTS form_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  form_id TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT 'new',
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_form_drafts_unique
  ON form_drafts(user_id, form_id, entity_id);

CREATE INDEX IF NOT EXISTS idx_form_drafts_user
  ON form_drafts(user_id);
