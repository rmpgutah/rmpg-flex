-- 0220: record disagreements between a scraped state warrant and a
-- manually-entered local record for the SAME real-world warrant.
--
-- WHY (found live 2026-08-01):
-- utahWarrantPoller matches existing rows only on
-- `external_warrant_id + external_source_key` -- its own scraped identity. It
-- never looks for a manually-entered row carrying the same warrant number
-- without the `UTW-` prefix, so the two coexist as separate rows and diverge
-- silently.
--
-- Live evidence: warrants 3149919 and 3155534 each had a UTW- twin with the
-- SAME issued_date and issuing_court. Both manual rows read 'active' while the
-- state source read 'recalled' with last_check_result='cleared' -- 2 of 23
-- warrants the system reported ACTIVE had in fact been recalled by Utah. Those
-- two records were corrected directly; this table is the durable half.
--
-- POLICY: flag, never auto-overwrite. An officer-entered status is not
-- silently replaced by a scraper -- the disagreement is recorded and surfaced
-- for a human to resolve. Resolution is recorded here too, so a conflict that
-- has been reviewed stops re-alerting.
--
-- Deliberately its own table rather than columns on `warrants`: that table is
-- at 50 columns against D1's 100-column SELECT cap, and a conflict is a
-- relationship between two rows, not an attribute of one.

CREATE TABLE IF NOT EXISTS warrant_source_conflicts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The officer-entered record.
  local_warrant_id    INTEGER NOT NULL REFERENCES warrants(id) ON DELETE CASCADE,
  -- The scraped record that disagrees with it.
  scraped_warrant_id  INTEGER NOT NULL REFERENCES warrants(id) ON DELETE CASCADE,
  -- Normalized number both rows share (the bare number, no source prefix).
  normalized_number   TEXT    NOT NULL,
  local_status        TEXT,
  scraped_status      TEXT,
  -- What corroborated the match beyond the number, e.g. 'issued_date+court'.
  match_basis         TEXT,
  source_key          TEXT    NOT NULL,
  detected_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Set when a human resolves it; NULL means still outstanding.
  resolved_at         TEXT,
  resolved_by         INTEGER,
  resolution_note     TEXT
);

-- One open conflict per pair — re-detection on the next poll must update the
-- existing row, not stack duplicates every 15 minutes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_warrant_conflicts_pair
  ON warrant_source_conflicts(local_warrant_id, scraped_warrant_id);

CREATE INDEX IF NOT EXISTS idx_warrant_conflicts_open
  ON warrant_source_conflicts(resolved_at, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_warrant_conflicts_number
  ON warrant_source_conflicts(normalized_number);
