-- 0107: National warrant pull — config-driven source registry + kind tag.
-- ⚠️ Apply directly to live D1 (785de7ae) after merge (deploy step is continue-on-error).
CREATE TABLE IF NOT EXISTS national_warrant_sources (
  source_key   TEXT PRIMARY KEY,
  family       TEXT NOT NULL,
  display_name TEXT NOT NULL,
  state        TEXT,
  jurisdiction TEXT,
  base_url     TEXT,
  resource_id  TEXT,
  field_map    TEXT,
  mode         TEXT NOT NULL DEFAULT 'full-list',
  format       TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'criminal',
  enabled      INTEGER NOT NULL DEFAULT 1,
  priority     INTEGER NOT NULL DEFAULT 3,
  created_at   TEXT DEFAULT (datetime('now'))
);

ALTER TABLE scraped_warrants ADD COLUMN kind TEXT DEFAULT 'criminal';

INSERT OR IGNORE INTO national_warrant_sources
  (source_key, family, display_name, state, jurisdiction, base_url, resource_id, field_map, mode, format, kind, enabled, priority) VALUES
  -- Baton Rouge (~113K rows) disabled in PR1: per-hit upsert would blow the cron budget. Re-enable after batched-ingest follow-up.
  ('socrata-brla-citycourt', 'socrata', 'Baton Rouge City Court Warrants', 'LA', 'Baton Rouge', 'data.brla.gov', '3j5u-jyar',
     '{"name":"name","dob":"dob","charge":"type","case_no":"fileno","issued":"doa","state":"state","city":"add3","race":"race","sex":"sex"}',
     'full-list', 'socrata', 'criminal', 0, 2),
  ('socrata-norfolk-pd', 'socrata', 'Norfolk VA Police Active Warrants', 'VA', 'Norfolk', 'data.norfolk.gov', 'cab7-wvn5',
     '{"first":"first","last":"last","dob":"dob","charge":"wa_chrg","issued":"issudate","sex":"sex","race":"race"}',
     'full-list', 'socrata', 'criminal', 1, 2),
  ('arcgis-arlington-tx', 'arcgis', 'Arlington TX Municipal Warrants', 'TX', 'Arlington',
     'https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Table/MapServer/9', NULL,
     '{"first":"FirstName","middle":"MiddleName","last":"LastName","charge":"OffenseDescription","case_no":"CitationNumber","bond":"AmountDue","issued":"WarrantIssuanceDate","warrant_type":"WarrantType","city":"City","state":"State"}',
     'full-list', 'arcgis', 'criminal', 1, 2);
