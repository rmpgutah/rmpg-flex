-- 0074_utah_statutes_plain_language.sql
-- Adds plain-language ("basic language and understanding") fields to the
-- utah_statutes law book so every section can carry an officer-readable
-- explanation alongside the verbatim statutory text.
--
--   • plain_summary  — 2-4 sentence plain-English explanation of the section
--   • plain_elements — JSON array of short "key point" bullets (elements of
--                      the offense, penalty, what an officer should know)
--   • summary_model  — provenance: which model generated the summary
--
-- ADDITIVE + NON-DESTRUCTIVE. utah_statutes has 19 columns (migration 0073),
-- nowhere near the D1 ~100-column SELECT cap, so a direct ADD COLUMN is safe
-- (unlike calls_for_service / persons — see CLAUDE.md gotcha 13).
--
-- D1 does NOT support `IF NOT EXISTS` on ADD COLUMN. deploy.yml applies
-- migrations with continue-on-error, and the live 785de7ae DB is ALTERed
-- out-of-band the same way the 0073 rebuild was, so a re-apply that errors
-- "duplicate column" is harmless.

ALTER TABLE utah_statutes ADD COLUMN plain_summary TEXT;
ALTER TABLE utah_statutes ADD COLUMN plain_elements TEXT;
ALTER TABLE utah_statutes ADD COLUMN summary_model TEXT;
