-- 0100: Intel Wave 1 — narrative link suggestions + plate sightings
-- (spec 2026-06-12). ⚠️ Apply directly to live D1 (785de7ae) after
-- merge — deploy-time migration apply is continue-on-error.
CREATE TABLE IF NOT EXISTS intel_link_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,            -- 'call' | 'incident'
  source_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,            -- 'person' | 'vehicle'
  entity_id INTEGER NOT NULL,
  extracted_text TEXT,
  match_basis TEXT,                     -- 'name' | 'plate' | 'phone'
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by INTEGER,
  decided_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (source_type, source_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_ils_status ON intel_link_suggestions(status);

CREATE TABLE IF NOT EXISTS vehicle_sightings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate TEXT NOT NULL,
  state TEXT,
  vehicle_id INTEGER,
  location_text TEXT,
  lat REAL,
  lng REAL,
  notes TEXT,
  sighted_by INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vs_plate ON vehicle_sightings(plate);
CREATE INDEX IF NOT EXISTS idx_vs_vehicle ON vehicle_sightings(vehicle_id);
