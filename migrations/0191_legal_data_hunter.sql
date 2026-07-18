-- 0191_legal_data_hunter.sql
-- Legal Data Hunter integration: caches manual "Validate Charge" lookups so
-- re-clicking the same charge text never re-spends the LDH rate budget.
-- See docs/superpowers/specs/2026-07-17-legal-data-hunter-integration-design.md
--
-- No new columns on `warrants` (100-column D1 cap, CLAUDE.md gotcha #13) —
-- linkage is via warrant_id on this table instead.

CREATE TABLE IF NOT EXISTS legal_charge_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  charge_text TEXT NOT NULL,
  charge_text_normalized TEXT NOT NULL,
  state TEXT,
  warrant_id INTEGER,
  source TEXT NOT NULL,           -- 'local_statute' | 'ldh_resolve' | 'ldh_search'
  match_found INTEGER NOT NULL,   -- 0/1
  matched_title TEXT,
  matched_citation TEXT,
  matched_source_url TEXT,
  raw_response TEXT,              -- JSON, for debugging/audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(charge_text_normalized, state)
);

CREATE INDEX IF NOT EXISTS idx_lcv_warrant ON legal_charge_validations(warrant_id);
CREATE INDEX IF NOT EXISTS idx_lcv_created ON legal_charge_validations(created_at);
