-- 0173: sor_enrichment_runs — audit log for per-state SOR detail-page
-- enrichment (fetches each offender's already-known detail_url and parses
-- offense/risk_level/tier out of it; see src/utils/sorEnrichment/). Not a
-- source-config table like national_warrant_sources — there's nothing to
-- toggle per-state in this pass, just 6 fixed code-resident parsers.
CREATE TABLE IF NOT EXISTS sor_enrichment_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offender_id INTEGER NOT NULL,
  jurisdiction TEXT NOT NULL,
  detail_url TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  error_message TEXT,
  parsed_offense TEXT,
  parsed_risk_level TEXT,
  raw_snippet TEXT,
  attempted_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sor_enrichment_offender ON sor_enrichment_runs(offender_id);
