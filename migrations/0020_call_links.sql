-- ============================================================
-- Migration 0020 — call_persons + call_vehicles link tables
-- ============================================================
-- DispatchPage already calls POST/GET/DELETE
-- /dispatch/calls/:id/persons and /vehicles. These tables back
-- those endpoints (see src/routes/dispatch/callLinks.ts).
-- ============================================================

CREATE TABLE IF NOT EXISTS call_persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'subject',  -- subject | victim | witness | reporting | other
  notes TEXT,
  added_by INTEGER,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(call_id, person_id, role)
);

CREATE INDEX IF NOT EXISTS idx_call_persons_call ON call_persons(call_id);
CREATE INDEX IF NOT EXISTS idx_call_persons_person ON call_persons(person_id);

CREATE TABLE IF NOT EXISTS call_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'subject',  -- subject | victim | suspect | involved | other
  notes TEXT,
  added_by INTEGER,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(call_id, vehicle_id, role)
);

CREATE INDEX IF NOT EXISTS idx_call_vehicles_call ON call_vehicles(call_id);
CREATE INDEX IF NOT EXISTS idx_call_vehicles_vehicle ON call_vehicles(vehicle_id);
