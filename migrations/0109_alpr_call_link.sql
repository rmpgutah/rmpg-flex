-- 0109: ALPR capture → call attachment + multi-vehicle linkage.
-- ⚠️ Apply directly to live D1 (785de7ae) after merge (deploy-time apply is
-- continue-on-error). The /api/alpr route also reconciles these columns at
-- runtime via columnExists(), so it self-heals if this never lands.
--
-- An on-scene ALPR capture now: (1) attaches the photo to a call via
-- field_photos (call_id) — surfaced as field_photo_id here; (2) extracts ALL
-- vehicles in the frame and, per plate, upserts vehicles_records + links it to
-- the call via call_vehicles + logs a vehicle_sighting. The created/linked
-- vehicle ids are stored as a JSON array in vehicle_record_ids.
--
-- D1 has no `IF NOT EXISTS` on ADD COLUMN — re-applying these errors harmlessly
-- (continue-on-error), and the runtime reconciler guards with columnExists.
ALTER TABLE alpr_captures ADD COLUMN call_id INTEGER;
ALTER TABLE alpr_captures ADD COLUMN incident_id INTEGER;
ALTER TABLE alpr_captures ADD COLUMN field_photo_id INTEGER;
ALTER TABLE alpr_captures ADD COLUMN vehicle_count INTEGER;
ALTER TABLE alpr_captures ADD COLUMN vehicle_record_ids TEXT;  -- JSON array of vehicles_records.id

CREATE INDEX IF NOT EXISTS idx_alpr_call ON alpr_captures(call_id);
CREATE INDEX IF NOT EXISTS idx_alpr_incident ON alpr_captures(incident_id);
