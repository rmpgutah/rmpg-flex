-- 0108: ALPR captures (Roboflow "ALPR Vehicle Details Capture" workflow).
-- ⚠️ Apply directly to live D1 (785de7ae) after merge — deploy-time
-- migration apply is continue-on-error (see CLAUDE.md). The /api/alpr
-- route also CREATE-IF-NOT-EXISTS this at runtime so it self-heals if the
-- migration never lands.
--
-- Design: vehicle_sightings (mig 0100) stays the canonical intel "plate
-- log" — each ALPR capture writes a row there too, so it flows through the
-- existing screen→notify→overview pipeline. This table holds the richer,
-- ALPR-specific payload (vehicle attributes, confidence, R2 image keys,
-- the real workflow output keys, and the normalized raw JSON), linked back
-- to the sighting by sighting_id.
--
-- ⚠️ KEEP IN SYNC: this 0108 definition is mirrored by the inline CREATE TABLE
-- in ensureAlprSchema (src/routes/alpr.ts). That inline DDL intentionally
-- covers only the original 0108+0109 columns; every LATER alpr_captures column
-- (0113 enrich_status, 0114 condition/damage_observed/damage_summary/
-- plate_confidence/accepted/reviewed_by/reviewed_at) is reconciled at runtime
-- via the ALPR_EXTRA_COLUMNS ADD COLUMN loop in that file. When you add a new
-- alpr_captures column in a future migration, you MUST also add it to
-- ALPR_EXTRA_COLUMNS so the runtime reconciler stays authoritative — the
-- inline CREATE TABLE is NOT updated for post-0109 columns. (vehicle_sightings
-- columns from 0115 belong to a different table — SIGHTING_EXTRA_COLUMNS — and
-- must NOT be added to the alpr_captures manifest.)
CREATE TABLE IF NOT EXISTS alpr_captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sighting_id INTEGER,                 -- → vehicle_sightings.id (intel link)
  capture_id TEXT,                     -- client/workflow capture id (offline-replay dedupe)
  case_id TEXT,
  plate TEXT,
  state TEXT,
  make TEXT,
  model TEXT,
  color TEXT,
  year INTEGER,
  vehicle_type TEXT,
  confidence REAL,
  risk_score REAL,
  review_status TEXT,
  alerted INTEGER DEFAULT 0,
  image_key TEXT,                      -- R2 key of the original captured image
  annotated_image_key TEXT,            -- R2 key of the Roboflow visualization (if any)
  output_keys TEXT,                    -- JSON array of the real workflow output names
  raw_json TEXT,                       -- normalized capture (scalars + detections), JSON
  lat REAL,
  lng REAL,
  location_text TEXT,
  captured_by INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alpr_plate ON alpr_captures(plate);
CREATE INDEX IF NOT EXISTS idx_alpr_sighting ON alpr_captures(sighting_id);
CREATE INDEX IF NOT EXISTS idx_alpr_case ON alpr_captures(case_id);
CREATE INDEX IF NOT EXISTS idx_alpr_capture_id ON alpr_captures(capture_id);
CREATE INDEX IF NOT EXISTS idx_alpr_created ON alpr_captures(created_at);
