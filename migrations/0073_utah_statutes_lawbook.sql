-- 0073_utah_statutes_lawbook.sql
-- Schema for the rebuilt utah_statutes "law book" scraped from le.utah.gov:
--   • Title 76  — Utah Criminal Code            (category 'criminal')
--   • Title 41  — Motor Vehicles                (category 'vehicle')
--   • Title 58 Ch 63 — Security Personnel Licensing Act      (category 'licensing')
--   • Title 58 Ch 92 — Private Investigation Licensing Act   (category 'licensing')
--   • Title 78B Ch 8 Pt 3 — Process Server Act               (category 'licensing')
--   • (Utah Administrative Code rules — code_type 'rule')
--
-- vs the old (0036) schema this ADDS chapter_code / part_name / code_type /
-- effective_date / source_url and DROPS the restrictive
-- CHECK(category IN ('criminal','vehicle')) so 'licensing' rows are allowed,
-- and CHECK(offense_level IN …) so the level set can evolve.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS FILE IS AN IN-PLACE UPGRADE, NOT A BARE `CREATE TABLE IF NOT EXISTS`
-- ─────────────────────────────────────────────────────────────────────────
-- `utah_statutes` already exists by the time the runner reaches 0073:
--   • 0036_utah_statutes.sql creates it with the OLD 14-column schema, and
--   • migrations/baseline/schema.sql (the `npm run migrate:local` bootstrap
--     snapshot of live) creates that SAME old schema and pre-records every
--     migration through 0071 in d1_migrations.
-- So a plain `CREATE TABLE IF NOT EXISTS utah_statutes (...new schema...)` is a
-- SILENT NO-OP — the new columns never get added — and the very next statement
-- (`CREATE INDEX ... (category, title, chapter_code)`) died with
-- "no such column: chapter_code", aborting the whole migration file and every
-- migration numbered after it. This file instead UPGRADES the existing table.
--
-- ─────────────────────────────────────────────────────────────────────────
-- NON-DESTRUCTIVE BY CONSTRUCTION
-- ─────────────────────────────────────────────────────────────────────────
-- The live `rmpg-flex` D1 (785de7ae-…) was rebuilt to this exact schema
-- out-of-band on 2026-06-02 (DROP+CREATE via the D1 API) and seeded from
-- scripts/seed/utah_statutes.sql (1,633 rows). On that DB — and on ANY DB that
-- already carries the law-book columns — the FIRST `ALTER … ADD COLUMN
-- chapter_code` below errors "duplicate column name", and wrangler aborts this
-- migration file at that first failing statement (it never reaches the rebuild
-- in step 3). The DROP/RENAME therefore CANNOT run against a populated law-book
-- table; it only ever runs on a freshly-upgraded, 0-row table on a local DB.
-- (deploy.yml applies migrations with continue-on-error, so the duplicate-column
-- abort on remote is harmless — live stays patched out-of-band.)
--
-- Data is loaded separately (scripts/seed/utah_statutes.sql) — intentionally NOT
-- inlined here to keep deploys from re-running a multi-MB INSERT.

-- 1. Defensive guard for a from-absolutely-nothing DB where NEITHER the baseline
--    snapshot NOR 0036 ran. Mirrors the 0036 (pre-law-book) column set so the
--    ALTERs in step 2 are the single, universal upgrade path in every case.
--    A no-op under the normal runner (the table already exists from baseline/0036).
--    Its CHECK constraints are intentionally stripped by the rebuild in step 3.
CREATE TABLE IF NOT EXISTS utah_statutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title INTEGER NOT NULL,
  chapter INTEGER,
  section TEXT NOT NULL,
  subsection TEXT,
  citation TEXT NOT NULL,
  short_title TEXT NOT NULL,
  description TEXT,
  offense_level TEXT,
  category TEXT NOT NULL,
  subcategory TEXT,
  citation_fine REAL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Add the law-book columns the pre-0073 table lacks. On a table that already
--    has them (live / already-rebuilt), the first ALTER errors "duplicate column
--    name" and wrangler aborts this file here — see the header. D1 does not
--    support IF NOT EXISTS on ADD COLUMN, so this abort IS the idempotency guard.
ALTER TABLE utah_statutes ADD COLUMN chapter_code   TEXT;
ALTER TABLE utah_statutes ADD COLUMN part_name      TEXT;
ALTER TABLE utah_statutes ADD COLUMN code_type      TEXT NOT NULL DEFAULT 'statute';
ALTER TABLE utah_statutes ADD COLUMN effective_date TEXT;
ALTER TABLE utah_statutes ADD COLUMN source_url     TEXT;

-- 3. Drop the restrictive CHECK(category IN ('criminal','vehicle')) and
--    CHECK(offense_level IN (...)) constraints carried over from 0036 — they
--    reject the 'licensing' / 'rule' law-book rows. SQLite can only drop a CHECK
--    by rebuilding the table. This runs ONLY on a table that just received the
--    step-2 columns (i.e. a fresh local DB, 0 rows); the column-list copy is
--    explicit and lossless, and preserves ids for any loose statute_id refs.
CREATE TABLE utah_statutes__lawbook (
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

INSERT INTO utah_statutes__lawbook
  (id, title, chapter, chapter_code, section, subsection, citation, short_title,
   description, offense_level, category, subcategory, part_name, code_type,
   effective_date, source_url, citation_fine, is_active, created_at)
SELECT
   id, title, chapter, chapter_code, section, subsection, citation, short_title,
   description, offense_level, category, subcategory, part_name, code_type,
   effective_date, source_url, citation_fine, is_active, created_at
FROM utah_statutes;

DROP TABLE utah_statutes;
ALTER TABLE utah_statutes__lawbook RENAME TO utah_statutes;

-- 4. Indexes (recreated after the rename).
CREATE INDEX IF NOT EXISTS idx_utah_statutes_citation  ON utah_statutes(citation);
CREATE INDEX IF NOT EXISTS idx_utah_statutes_active    ON utah_statutes(is_active);
CREATE INDEX IF NOT EXISTS idx_utah_statutes_category  ON utah_statutes(category, subcategory);
CREATE INDEX IF NOT EXISTS idx_utah_statutes_chapter   ON utah_statutes(category, title, chapter_code);
