-- Inline call subjects and vehicles for ad-hoc dispatch data entry.
-- These tables store data directly (no FK to persons/vehicles_records)
-- for quick entry without requiring a pre-existing record.

CREATE TABLE IF NOT EXISTS call_involved_persons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id    INTEGER NOT NULL REFERENCES calls_for_service(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  dob        TEXT,
  id_number  TEXT,
  role       TEXT    NOT NULL DEFAULT 'witness',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_inv_persons_call ON call_involved_persons(call_id);

CREATE TABLE IF NOT EXISTS call_involved_vehicles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id    INTEGER NOT NULL REFERENCES calls_for_service(id) ON DELETE CASCADE,
  plate      TEXT,
  make       TEXT,
  model      TEXT,
  color      TEXT,
  role       TEXT    NOT NULL DEFAULT 'involved',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_inv_vehicles_call ON call_involved_vehicles(call_id);
