-- Advanced vehicle scanner — structured per-observation damage on the sighting.
--
-- The merged scanner (#1244) stores damage on alpr_captures + in the
-- vehicle_sightings.notes string + raw_json, but the spec
-- (2026-06-14-advanced-vehicle-scanner-design.md §5, lines 185-186) also calls
-- for the damage/condition fields as first-class columns on vehicle_sightings
-- so per-observation damage is queryable, not buried in free text. This adds
-- them.
--
-- NOTE on the spec's `accepted INTEGER`: it is intentionally OMITTED. #1244
-- adopted a stronger "gate-before-record" design — a vehicle_sightings row is
-- created ONLY for an accepted (>=85%) read (enrich) or an officer-confirmed
-- read (POST /accept). Every ALPR sighting is therefore already verified, so a
-- per-row `accepted` flag would be a meaningless always-1 column. `confidence`
-- (the plate-read confidence of the sighting) is kept — it still varies and is
-- useful intel.
--
-- D1 has NO `IF NOT EXISTS` on `ADD COLUMN`; a re-apply that errors is fine —
-- the route also self-heals these at boot (ensureAlprSchema in
-- src/routes/alpr.ts: SIGHTING_EXTRA_COLUMNS).
ALTER TABLE vehicle_sightings ADD COLUMN condition TEXT;
ALTER TABLE vehicle_sightings ADD COLUMN damage_observed INTEGER;
ALTER TABLE vehicle_sightings ADD COLUMN damage_summary TEXT;
ALTER TABLE vehicle_sightings ADD COLUMN confidence REAL;
