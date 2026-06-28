-- 0118_vehicle_capture_photos.sql
-- Per-vehicle-per-capture 3-photo evidence package + derived trust.
CREATE TABLE IF NOT EXISTS vehicle_capture_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capture_id INTEGER,
  vehicle_record_id INTEGER,
  canonical_plate TEXT,
  raw_reads_json TEXT,
  variants_json TEXT,
  read_count INTEGER DEFAULT 1,
  consensus_ratio REAL,
  trust_score REAL,
  trust_basis TEXT,
  full_r2_key TEXT,
  vehicle_r2_key TEXT,
  plate_r2_key TEXT,
  vehicle_bbox_json TEXT,
  plate_bbox_json TEXT,
  source_type TEXT,
  asserted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_vcp_vehicle ON vehicle_capture_photos(vehicle_record_id);
CREATE INDEX IF NOT EXISTS idx_vcp_canonical ON vehicle_capture_photos(canonical_plate);
CREATE INDEX IF NOT EXISTS idx_vcp_capture ON vehicle_capture_photos(capture_id);
