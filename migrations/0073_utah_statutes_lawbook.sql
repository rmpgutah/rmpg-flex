-- 0073_utah_statutes_lawbook.sql
-- Schema for the rebuilt utah_statutes "law book" scraped from le.utah.gov:
--   • Title 76  — Utah Criminal Code            (category 'criminal')
--   • Title 41  — Motor Vehicles                (category 'vehicle')
--   • Title 58 Ch 63 — Security Personnel Licensing Act      (category 'licensing')
--   • Title 58 Ch 92 — Private Investigation Licensing Act   (category 'licensing')
--   • Title 78B Ch 8 Pt 3 — Process Server Act               (category 'licensing')
--   • (Utah Administrative Code rules — code_type 'rule')
--
-- vs the old schema this adds chapter_code / part_name / code_type /
-- effective_date / source_url and DROPS the restrictive
-- CHECK(category IN ('criminal','vehicle')) so 'licensing' rows are allowed,
-- and CHECK(offense_level IN …) so the level set can evolve.
--
-- NON-DESTRUCTIVE BY DESIGN. The live `rmpg-flex` D1 (785de7ae-…) was rebuilt
-- to this exact schema out-of-band on 2026-06-02 (DROP+CREATE via the D1 API)
-- and seeded from scripts/seed/utah_statutes.sql (1,633 rows). This file uses
-- CREATE TABLE IF NOT EXISTS so re-applying it on deploy CANNOT wipe that live
-- data — it is a no-op against the already-rebuilt table and only does real work
-- on a fresh database. The audit that made the rebuild safe: 0 rows in
-- `citations`, so no statute_id FK pointed at the old ids.
--
-- Data is loaded separately (scripts/seed/utah_statutes.sql), matching the
-- original seed's pattern — it is intentionally NOT inlined here to keep deploys
-- from re-running a multi-MB INSERT.

CREATE TABLE IF NOT EXISTS utah_statutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  title INTEGER NOT NULL,                  -- 76, 41, 58, 78 (78B encoded as 78)
  chapter INTEGER,                         -- leading integer of the chapter
  chapter_code TEXT,                       -- authoritative chapter incl. suffix: "5b", "6a", "63", "92"
  section TEXT NOT NULL,                   -- "102", "102.1", "302"
  subsection TEXT,
  citation TEXT NOT NULL,                  -- "76-5-102", "58-63-302", "78B-8-302"
  short_title TEXT NOT NULL,               -- catchline, e.g. "Assault"

  description TEXT,                        -- full formatted statutory text
  offense_level TEXT,                      -- most-severe penalty class found, or NULL
  category TEXT NOT NULL,                  -- 'criminal' | 'vehicle' | 'licensing'
  subcategory TEXT,                        -- chapter (or Part) name
  part_name TEXT,
  code_type TEXT NOT NULL DEFAULT 'statute', -- 'statute' | 'rule'

  effective_date TEXT,                     -- in-force version effective date (M/D/YYYY)
  source_url TEXT,                         -- canonical le.utah.gov / adminrules link
  citation_fine REAL,

  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_utah_statutes_citation  ON utah_statutes(citation);
CREATE INDEX IF NOT EXISTS idx_utah_statutes_active    ON utah_statutes(is_active);
CREATE INDEX IF NOT EXISTS idx_utah_statutes_category  ON utah_statutes(category, subcategory);
CREATE INDEX IF NOT EXISTS idx_utah_statutes_chapter   ON utah_statutes(category, title, chapter_code);
