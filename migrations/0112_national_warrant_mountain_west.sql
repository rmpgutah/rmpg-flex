-- 0112: Mountain West (Utah-region) warrant sources — structured XML + CSV families.
-- ⚠️ Apply directly to live D1 (785de7ae) after deploy (deploy step is continue-on-error).
--
-- Verified live 2026-06-13. The major CO/NV/NM/AZ metros publish only name-search portals
-- (no bulk rosters), and Socrata was in a platform-wide outage — but ID + WY yielded clean
-- STRUCTURED bulk feeds:
--   Bonner County ID — sheriff XML (felony + misdemeanor), carries DOB. ~86 + ~890 records.
--   Teton County WY — Zuercher portal CSV export (`web_warrant_list.csv`). The username/
--     password below are the sheriff's OWN published read-only "viewinmates" viewer
--     credentials (printed on their public warrant page); this is the documented public
--     access method. The csv-zuercher parser is reusable for any Zuercher-portal sheriff.
INSERT OR IGNORE INTO national_warrant_sources
  (source_key, family, display_name, state, jurisdiction, base_url, resource_id, field_map, mode, format, kind, enabled, priority) VALUES
  ('xml-bonner-felony-id', 'xml-bonner', 'Bonner County ID Sheriff Felony Warrants', 'ID', 'Bonner', 'https://bonnerso.org/public-reports/warrantsf.xml', NULL, NULL, 'full-list', 'xml', 'criminal', 1, 3),
  ('xml-bonner-misd-id', 'xml-bonner', 'Bonner County ID Sheriff Misdemeanor Warrants', 'ID', 'Bonner', 'https://bonnerso.org/public-reports/warrantsm.xml', NULL, NULL, 'full-list', 'xml', 'criminal', 1, 3),
  ('csv-zuercher-teton-wy', 'csv-zuercher', 'Teton County WY Sheriff Warrants', 'WY', 'Teton', 'https://teton-so-wy.zuercherportal.com/interfaces/web_warrant_list.csv?username=viewinmates&password=This_IS_my_N3w_1nmat3pa$$w0rd!', NULL, NULL, 'full-list', 'csv', 'criminal', 1, 3);
