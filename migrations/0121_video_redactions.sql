-- 0121_video_redactions.sql — chain-of-custody for in-video redaction exports.
-- Idempotent (CREATE TABLE IF NOT EXISTS). The redactions route also reconciles
-- columns at runtime via columnExists() because deploy migration-apply is
-- continue-on-error. APPLY DIRECTLY TO LIVE D1 785de7ae AFTER MERGE.
CREATE TABLE IF NOT EXISTS video_redactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_event_id INTEGER,
  r2_key          TEXT NOT NULL,
  kinds           TEXT,
  region_count    INTEGER NOT NULL DEFAULT 0,
  style           TEXT,
  regions_json    TEXT,
  redacted_by     INTEGER,
  status          TEXT NOT NULL DEFAULT 'completed',
  requested_at    TEXT,
  completed_at    TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_video_redactions_event ON video_redactions (source_event_id);
