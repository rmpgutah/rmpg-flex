-- 0172: consecutive_errors on both warrant-source config tables — drives
-- the circuit_broken flag (via the existing isCircuitOpen() pure function
-- in src/utils/warrantSources/resilience.ts, threshold 5) for the
-- /api/warrants/scrapers ops surface (ScrapersTab.tsx +
-- AdminWarrantScrapersTab.tsx, both previously unbacked — 2026-07-04).
--
-- D1 lacks ALTER TABLE ADD COLUMN IF NOT EXISTS; re-applying this on a DB
-- that already has the column fails with "duplicate column name" — expected,
-- see migrations/README.md.
ALTER TABLE warrant_scraper_config ADD COLUMN consecutive_errors INTEGER NOT NULL DEFAULT 0;
ALTER TABLE national_warrant_sources ADD COLUMN consecutive_errors INTEGER NOT NULL DEFAULT 0;
