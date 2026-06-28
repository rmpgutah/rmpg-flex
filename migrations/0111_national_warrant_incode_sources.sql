-- 0111: INCODE / Tyler "WRNTLST" municipal-court warrant sources (TX). Carries DOB + race/sex.
-- ⚠️ Apply directly to live D1 (785de7ae) after deploy (deploy step is continue-on-error).
--
-- Verified live 2026-06-13 via the pdf-incode parser. Both are bulk PDF rosters with DOB —
-- the major TX cities (Houston/Dallas/Austin/San Antonio/Fort Worth/El Paso) publish only
-- name-search portals, not bulk lists, so they are not ingestable. INCODE is a common Texas
-- court format; more INCODE cities can be added as rows here without code changes.
--
-- Beaumont's URL (DocumentCenter/View/529) is stable + current. Harlingen's filename is
-- date-stamped (.../Warrant_Listing_<MMDDYYYY>.pdf) and rotates; a stale URL degrades to []
-- (no crash, and the full-list leg's found>0 guard means a 404 won't clear the roster) —
-- PR2b adds landing-page link discovery to resolve the current dated file each run.
INSERT OR IGNORE INTO national_warrant_sources
  (source_key, family, display_name, state, jurisdiction, base_url, resource_id, field_map, mode, format, kind, enabled, priority) VALUES
  ('pdf-incode-beaumont-tx', 'pdf-incode', 'Beaumont TX Municipal Warrants', 'TX', 'Beaumont', 'https://www.beaumonttexas.gov/DocumentCenter/View/529/Active-Warrants-PDF', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  ('pdf-incode-harlingen-tx', 'pdf-incode', 'Harlingen TX Municipal Warrants', 'TX', 'Harlingen', 'https://www.harlingentx.gov/Document/Departments/Municipal%20Court/Warrant/Warrant_Listing_07302024.pdf', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3);
