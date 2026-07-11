-- 0170: court_lookups — editable dropdown values for the Court Tracker
-- (courts, judges, prosecutors, event types, outcomes, pleas, bond
-- statuses, witness types, officer roles, charge codes, and any new
-- category an admin adds). Backs AdminCourtLookupsTab.tsx, which was
-- shipped with a complete UI but no matching table/routes (broken-
-- functionality audit, 2026-07-04).
CREATE TABLE IF NOT EXISTS court_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  value TEXT NOT NULL,
  display_label TEXT,
  meta TEXT,
  display_order INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_court_lookups_category ON court_lookups(category, display_order);
