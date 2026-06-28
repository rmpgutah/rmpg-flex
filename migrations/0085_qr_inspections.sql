-- 0085_qr_inspections.sql
-- Per-shift QR token + vehicle inspection rows.
--
-- The qr_token on time_entries is generated at /dispatch/duty/start and embedded
-- in a QR rendered on the ShiftCard. The officer scans it with their phone to
-- open /m/shift/<token>, which loads the pre-shift / post-shift vehicle
-- walkthrough. The token IS the auth for that public page — it auto-expires
-- when the shift's clock_out is set (the inspection route filters on
-- clock_out IS NULL), so a stolen QR from yesterday's session is dead.
--
-- vehicle_inspections holds one row per phase ('pre' at shift start, 'post' at
-- shift end) per time_entry. equipment_json is a JSON map like
-- {"radio":"ok","aed":"missing","light_bar":"damaged"}; photo_keys_json is a
-- JSON array of R2 object keys under vehicle-inspections/<entry_id>/<phase>/.
-- Both are TEXT because D1 has no native JSON column.

ALTER TABLE time_entries ADD COLUMN qr_token TEXT;
CREATE INDEX IF NOT EXISTS idx_time_entries_qr_token ON time_entries(qr_token);

CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time_entry_id INTEGER NOT NULL,
  officer_id INTEGER,
  vehicle_id INTEGER,
  phase TEXT NOT NULL CHECK (phase IN ('pre','post')),
  fuel_level TEXT,
  odometer REAL,
  equipment_json TEXT,
  damage_notes TEXT,
  photo_keys_json TEXT,
  exterior_ok INTEGER DEFAULT 1,
  notes TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (time_entry_id) REFERENCES time_entries(id)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_time_entry ON vehicle_inspections(time_entry_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_inspections_entry_phase ON vehicle_inspections(time_entry_id, phase);
