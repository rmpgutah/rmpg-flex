-- ============================================================
-- 0036_utah_statutes.sql
-- ============================================================
-- Backports the utah_statutes table to source after it was applied
-- manually to live D1 (785de7ae-…) on 2026-05-24 to unblock the legacy
-- /api/statutes/search 500. See PR #635 + incident-2026-05-24-dual-worker.md.
--
-- Schema reconciles two upstream sources of disagreement:
--   - legacy/server-vps/migrations/0001_full_sync.sql declares the table
--     WITHOUT a `citation_fine` column.
--   - The deployed legacy rmpg-flex Worker's GET /api/statutes/search
--     handler SELECTs `citation_fine`.
-- This migration adds `citation_fine` so the handler stops crashing on
-- "no such column."
--
-- The table is intentionally seedless. Real statute data lives in
-- utah.gov / code.utah.gov / a VPS backup — out of scope for the
-- migration. Once seeded, the proxy stub in PR #635 should be removed
-- so live data flows through to the legacy handler.

CREATE TABLE IF NOT EXISTS utah_statutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Statute identification — taken verbatim from Utah Code.
  title INTEGER NOT NULL,                 -- e.g. 76 (Criminal Code)
  chapter INTEGER,
  section TEXT NOT NULL,                  -- e.g. "6-404" — text, not INTEGER,
                                          -- since some sections have letter
                                          -- suffixes (e.g. "6-404.5")
  subsection TEXT,
  citation TEXT NOT NULL,                 -- full reassembled e.g. "76-6-404"
  short_title TEXT NOT NULL,              -- "Theft, generally"

  -- Operational fields used by the search/UI layer.
  description TEXT,
  offense_level TEXT CHECK(offense_level IN (
    'capital_felony',
    'first_degree_felony','second_degree_felony','third_degree_felony',
    'class_a_misdemeanor','class_b_misdemeanor','class_c_misdemeanor',
    'infraction','enhancement', NULL
  )),
  category TEXT NOT NULL CHECK(category IN ('criminal','vehicle')),
  subcategory TEXT,

  -- Suggested citation fine (vehicle infractions etc.). Nullable —
  -- criminal statutes don't have a flat-rate fine.
  citation_fine REAL,

  -- Lifecycle.
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Primary search index — `citation LIKE '76-%'` query covered.
CREATE INDEX IF NOT EXISTS idx_utah_statutes_citation
  ON utah_statutes(citation);

-- "Active statutes only" — the dominant filter on every read.
CREATE INDEX IF NOT EXISTS idx_utah_statutes_active
  ON utah_statutes(is_active);

-- Browse-by-category in the report-writer's faceted UI.
CREATE INDEX IF NOT EXISTS idx_utah_statutes_category
  ON utah_statutes(category, subcategory);
