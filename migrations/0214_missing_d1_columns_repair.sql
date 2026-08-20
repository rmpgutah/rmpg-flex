-- 0214_missing_d1_columns_repair.sql
-- Repairs two schema gaps found by scripts/check-schema-refs.py against live
-- D1 on 2026-07-30. Both call sites are wrapped in .catch(), so the features
-- were permanently inert rather than erroring — no crash, no empty log.
--
-- 1) incident_photos never existed. src/routes/dispatch/extensions.ts copies a
--    call's field photos onto the generated incident; every INSERT was a no-op.
-- 2) bodycam_videos.incident_id never landed. src/routes/useOfForce.ts's
--    /:id/footage BWC feed filters on it, so it always returned [].

CREATE TABLE IF NOT EXISTS incident_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  photo_id INTEGER NOT NULL,        -- field_photos.id
  call_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(incident_id, photo_id)
);
CREATE INDEX IF NOT EXISTS idx_incident_photos_incident ON incident_photos(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_photos_photo ON incident_photos(photo_id);

-- D1 does not support IF NOT EXISTS on ADD COLUMN; this fails harmlessly on
-- re-apply ("duplicate column name") and the deploy step is continue-on-error.
ALTER TABLE bodycam_videos ADD COLUMN incident_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_bodycam_videos_incident ON bodycam_videos(incident_id);

-- Remaining gaps found by scripts/check-schema-refs-deep.py (qualified refs,
-- INSERT column lists and UPDATE SET targets — the clauses the original
-- single-table checker never inspected). Every column below is referenced by
-- live route code and exists on NO live table, so these are additive only.
-- Sites whose "missing" column had a real live equivalent were fixed by
-- renaming the query instead; those are not listed here.

-- geofences shipped as a 4-column stub (id, name, is_active, created_at) while
-- POST /dispatch/geofences writes a full definition.
ALTER TABLE geofences ADD COLUMN geojson TEXT;
ALTER TABLE geofences ADD COLUMN alert_type TEXT;
ALTER TABLE geofences ADD COLUMN created_by INTEGER;
ALTER TABLE geofences ADD COLUMN updated_at TEXT;

-- The originating incident for a case (dispatch/extensions.ts "generate case
-- from incident" both SELECTs and INSERTs it).
ALTER TABLE cases ADD COLUMN incident_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_cases_incident ON cases(incident_id);

-- Panic activation context + the auto-dispatched backup it created.
ALTER TABLE panic_alerts ADD COLUMN unit_id INTEGER;
ALTER TABLE panic_alerts ADD COLUMN source TEXT;
ALTER TABLE panic_alerts ADD COLUMN backup_call_id INTEGER;
ALTER TABLE panic_alerts ADD COLUMN backup_units TEXT;

-- Per-call vehicle timeline + mileage (fleet.ts vehicle call history).
ALTER TABLE call_vehicles ADD COLUMN dispatched_at TEXT;
ALTER TABLE call_vehicles ADD COLUMN arrived_at TEXT;
ALTER TABLE call_vehicles ADD COLUMN cleared_at TEXT;
ALTER TABLE call_vehicles ADD COLUMN starting_mileage INTEGER;
ALTER TABLE call_vehicles ADD COLUMN ending_mileage INTEGER;

-- Odometer at assign/unassign (personnel.ts officer vehicle history).
ALTER TABLE fleet_assignments ADD COLUMN mileage_at_assign INTEGER;
ALTER TABLE fleet_assignments ADD COLUMN mileage_at_unassign INTEGER;

-- Work-request lifecycle for maintenance auto-escalated from a failed pre-trip
-- inspection ('requested' → shop workflow). inspections.ts writes it.
ALTER TABLE fleet_maintenance ADD COLUMN status TEXT;

-- Live route-progress tracking for a server's optimized serve route.
ALTER TABLE serve_routes ADD COLUMN visited_queue_ids TEXT;
ALTER TABLE serve_routes ADD COLUMN current_lat REAL;
ALTER TABLE serve_routes ADD COLUMN current_lng REAL;
