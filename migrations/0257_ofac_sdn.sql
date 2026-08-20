-- OFAC Specially Designated Nationals cache
-- Populated weekly by cron; searched locally by enrichment adapter
CREATE TABLE IF NOT EXISTS ofac_sdn (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  sdn_name         TEXT NOT NULL,
  sdn_type         TEXT NOT NULL DEFAULT 'individual',  -- 'individual' | 'entity' | 'vessel'
  program          TEXT,             -- SDNT, IRAN, CUBA, etc.
  aliases_json     TEXT,             -- JSON array of alt names
  dob              TEXT,             -- YYYY-MM-DD or partial
  nationality      TEXT,
  remarks          TEXT,
  last_refreshed   TEXT NOT NULL DEFAULT (datetime('now')),
  source_row_id    TEXT UNIQUE       -- original CSV row identifier to deduplicate
);
CREATE INDEX IF NOT EXISTS idx_ofac_sdn_name ON ofac_sdn(sdn_name);
CREATE INDEX IF NOT EXISTS idx_ofac_sdn_type ON ofac_sdn(sdn_type);
CREATE INDEX IF NOT EXISTS idx_ofac_sdn_refreshed ON ofac_sdn(last_refreshed);
