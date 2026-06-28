-- 0098: Intel Search + Entity Resolution (spec 2026-06-11)
-- FTS5 index over all record types + person resolution tables.
-- ⚠️ Per project rules, ALSO apply this directly to live D1 (785de7ae)
-- after merge — the deploy-time migration step is continue-on-error.
CREATE VIRTUAL TABLE IF NOT EXISTS intel_index USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  label,
  body,
  identifiers,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS intel_index_state (
  entity_type TEXT PRIMARY KEY,
  last_synced_at TEXT,
  row_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entity_resolution_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_a INTEGER NOT NULL,
  person_b INTEGER NOT NULL,
  score REAL NOT NULL,
  reasons TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by INTEGER,
  decided_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (person_a, person_b)
);
CREATE INDEX IF NOT EXISTS idx_ers_status ON entity_resolution_suggestions(status);

CREATE TABLE IF NOT EXISTS person_canonical (
  person_id INTEGER PRIMARY KEY,
  canonical_person_id INTEGER NOT NULL,
  confirmed_by INTEGER,
  confirmed_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pc_canonical ON person_canonical(canonical_person_id);
