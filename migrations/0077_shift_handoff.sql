-- 0077_shift_handoff.sql
-- Single-row shift handoff notes visible across all dispatch consoles.
-- Stores one current handoff blob — the most recent dispatcher who saved it
-- wins. The client fetches this on page load and disp lays it in a modal.
CREATE TABLE IF NOT EXISTS shift_handoff (
  id INTEGER PRIMARY KEY DEFAULT 1,
  text TEXT NOT NULL DEFAULT '',
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT only_one_row CHECK (id = 1)
);

INSERT OR IGNORE INTO shift_handoff (id, text) VALUES (1, '');
