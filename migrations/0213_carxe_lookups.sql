-- 0213_carxe_lookups.sql
-- Cache table for CarsXE API lookups (plate decode, VIN specs, lien/theft,
-- history). Avoids re-billing CarsXE credits on repeat lookups and gives
-- an audit trail of who looked up what. See
-- docs/superpowers/specs/2026-07-30-carxe-api-integration-design.md
CREATE TABLE IF NOT EXISTS carxe_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lookup_type TEXT NOT NULL,        -- 'plate' | 'vin_specs' | 'lien_theft' | 'history'
  plate TEXT,
  state TEXT,
  vin TEXT,
  response_json TEXT NOT NULL,
  requested_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_carxe_lookups_plate ON carxe_lookups(plate, state);
CREATE INDEX IF NOT EXISTS idx_carxe_lookups_vin ON carxe_lookups(vin, lookup_type);
