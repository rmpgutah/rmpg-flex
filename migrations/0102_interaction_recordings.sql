-- 0102: In-app interaction audio recordings (Intel Wave 3b).
-- Metadata only; audio chunks live in R2 (UPLOADS bucket, prefix
-- interactions/<id>/<seq>.webm). ⚠️ Apply directly to live D1 after merge.
CREATE TABLE IF NOT EXISTS interaction_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  duration_sec INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  mime TEXT DEFAULT 'audio/webm',
  status TEXT NOT NULL DEFAULT 'recording', -- recording|complete|aborted
  location_text TEXT,
  lat REAL,
  lng REAL,
  linked_fi_id INTEGER,
  linked_call_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ir_officer ON interaction_recordings(officer_id, created_at);
