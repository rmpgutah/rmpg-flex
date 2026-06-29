-- ============================================================
-- 0162: Call templates + citation autofill schema
-- ============================================================
-- Supports:
--   - Reusable dispatch call templates (save/apply common patterns)
--   - Template sharing between users
--   - Usage tracking for sorting
-- ============================================================

CREATE TABLE IF NOT EXISTS call_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  incident_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'P3',
  auto_flags TEXT DEFAULT '{}',
  notes TEXT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  is_shared INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_call_templates_owner ON call_templates(owner_user_id, active);
CREATE INDEX IF NOT EXISTS idx_call_templates_shared ON call_templates(is_shared, active);
