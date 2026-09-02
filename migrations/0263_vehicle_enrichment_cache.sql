-- migrations/0263_vehicle_enrichment_cache.sql
CREATE TABLE IF NOT EXISTS vehicle_enrichment_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_key TEXT NOT NULL,
  plate_number TEXT NOT NULL,
  state TEXT,
  vin TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,
  trim TEXT,
  color TEXT,
  vehicle_type TEXT,
  raw_plate_to_vin TEXT,
  raw_vin_decoder TEXT,
  raw_plate_decoder TEXT,
  enriched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_enrichment_cache_plate_key
  ON vehicle_enrichment_cache(plate_key);
