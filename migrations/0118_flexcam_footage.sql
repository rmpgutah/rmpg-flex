-- migrations/0118_flexcam_footage.sql
-- FlexCam full-trip footage capture. Idempotent DDL (CREATE IF NOT EXISTS).
-- ⚠️ Apply directly to live D1 785de7ae after merge (deploy apply is continue-on-error).
CREATE TABLE IF NOT EXISTS footage_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'clearpathgps',
  asset_id INTEGER NOT NULL,
  cpg_device_id TEXT,
  unit_id INTEGER,
  trip_id TEXT,
  call_id INTEGER,
  from_ts INTEGER NOT NULL,
  to_ts INTEGER NOT NULL,
  reason TEXT NOT NULL,                       -- trip_auto | on_demand | critical_event
  status TEXT NOT NULL DEFAULT 'queued',      -- queued|fulfilling|complete|partial|failed
  chunk_count INTEGER DEFAULT 0,
  chunks_done INTEGER DEFAULT 0,
  bytes INTEGER DEFAULT 0,
  merged_r2_key TEXT,
  merged_status TEXT,                         -- null|pending|ready|unsupported
  title TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_footage_req_status ON footage_requests(status);
CREATE INDEX IF NOT EXISTS idx_footage_req_trip ON footage_requests(trip_id);
CREATE INDEX IF NOT EXISTS idx_footage_req_call ON footage_requests(call_id);

CREATE TABLE IF NOT EXISTS footage_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  from_ts INTEGER NOT NULL,
  to_ts INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'outside',
  vendor_media_id TEXT,
  r2_key TEXT,
  content_type TEXT,
  bytes INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'requested',   -- requested|available|downloaded|missing|error
  alpr_status TEXT DEFAULT 'pending',         -- pending|done|skipped
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_footage_chunks_req ON footage_chunks(request_id, seq);
CREATE INDEX IF NOT EXISTS idx_footage_chunks_status ON footage_chunks(status);
