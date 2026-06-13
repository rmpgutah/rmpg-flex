-- 0109: PDF warrant sources for the national pull (PR2) + re-enable Baton Rouge.
-- ⚠️ Apply directly to live D1 (785de7ae) after merge (deploy step is continue-on-error).
--
-- Only sources VERIFIED (2026-06-13) to fetch + parse into real warrants are enabled=1.
-- Dated Zuercher URLs (McKenzie) rotate; a stale URL degrades to [] (no crash) — PR2b adds
-- landing-page link discovery. Tuscarawas OH downloads but uses a different Zuercher column
-- layout (0 hits with the McKenzie/Codington parser) so it is staged enabled=0 for PR2b.
INSERT OR IGNORE INTO national_warrant_sources
  (source_key, family, display_name, state, jurisdiction, base_url, resource_id, field_map, mode, format, kind, enabled, priority) VALUES
  -- Zuercher / CentralSquare (flat-text parser) — verified live: McKenzie 2,589 hits; Codington 1,305 hits.
  ('pdf-zuercher-mckenzie-nd', 'pdf-zuercher', 'McKenzie County ND Sheriff Warrants', 'ND', 'McKenzie', 'https://www.mckenziesheriff.net/usrfiles/cp/warrant_list_11-15-24.pdf', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  ('pdf-zuercher-codington-sd', 'pdf-zuercher', 'Codington County SD Sheriff Warrants', 'SD', 'Codington', 'https://codington.sdcounty.gov/sheriff/information/warrants/Warrants.pdf', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  ('pdf-zuercher-tuscarawas-oh', 'pdf-zuercher', 'Tuscarawas County OH Sheriff Warrants', 'OH', 'Tuscarawas', 'https://cms3.revize.com/revize/tuscarawas/_assets_/files/Active_Warrants_list_for_TCSO_website.pdf', NULL, NULL, 'full-list', 'pdf', 'criminal', 0, 3),
  -- TX-municipal (line-mode parser) — verified live.
  ('pdf-txmuni-killeen-tx', 'pdf-txmuni', 'Killeen TX Municipal Warrants', 'TX', 'Killeen', 'https://www.killeentexas.gov/DocumentCenter/View/6548/Active-Warrant-List-PDF', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  ('pdf-txmuni-bellmead-tx', 'pdf-txmuni', 'Bell Mead TX Municipal Warrants', 'TX', 'Bell Mead', 'https://bellmeadtx.gov/DocumentCenter/View/1486/Active-Warrant-Listing-as-of-December-18-2025', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  ('pdf-txmuni-taylor-tx', 'pdf-txmuni', 'Taylor TX Municipal Warrants', 'TX', 'Taylor', 'https://www.taylortx.gov/DocumentCenter/View/15624/Updated-Warrant-List-2025', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  -- Newton GA (column-major parser, includes DOB) — verified live.
  ('pdf-newton-ga', 'pdf-newton', 'Newton County GA Sheriff Warrants', 'GA', 'Newton', 'https://cdn.myocv.com/ocvapps/a70830014/files/012926%20Warrants.PDF', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3);

-- Re-enable Baton Rouge (~113K rows) now that batched ingest (PR2 Task 2) replaces the
-- per-hit upsert. Batches of 100 via D1 batch() (binding ops don't count toward the fetch
-- subrequest cap). If the live cron budget proves tight, set enabled=0 again — it's reversible.
UPDATE national_warrant_sources SET enabled = 1 WHERE source_key = 'socrata-brla-citycourt';
