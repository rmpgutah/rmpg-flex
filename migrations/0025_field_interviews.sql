-- ============================================================
-- 0025_field_interviews.sql
-- ============================================================
-- Field Interview (FI) cards — officer-initiated contact records
-- with GPS, subject details, vehicle observed, and disposition.
-- Phase 1 RMS port per the retirement plan.
--
-- Schema mirrors the legacy CREATE TABLE plus every runtime
-- `addCol()` the VPS applied later (date, gang_affiliation,
-- section_id, zone_id, beat_id, zone_beat, updated_at) so the
-- live D1 has the full evolved column set, not just the original.
-- ============================================================

CREATE TABLE IF NOT EXISTS field_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fi_number TEXT UNIQUE NOT NULL,
  -- Date the FI took place (officer-supplied, not server-generated)
  -- — distinct from `created_at` which records when the row was inserted.
  date TEXT,
  person_id INTEGER,
  subject_first_name TEXT,
  subject_last_name TEXT,
  subject_dob TEXT,
  subject_gender TEXT,
  subject_race TEXT,
  subject_height TEXT,
  subject_weight TEXT,
  subject_hair TEXT,
  subject_eye TEXT,
  subject_clothing TEXT,
  subject_description TEXT,
  location TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  property_id INTEGER,
  contact_reason TEXT NOT NULL DEFAULT 'other',
  contact_type TEXT DEFAULT 'field',
  -- action_taken is the canonical column. The legacy API exposes
  -- `disposition` as a body-alias mapping to this column — preserved
  -- in this port's POST/PUT handlers. (Legacy GET filters referenced
  -- `disposition` directly and silently never matched — fixed in port.)
  action_taken TEXT DEFAULT 'none',
  narrative TEXT,
  vehicle_plate TEXT,
  vehicle_description TEXT,
  vehicle_id INTEGER,
  associated_call_id TEXT,
  associated_incident_id TEXT,
  gang_affiliation TEXT,
  -- District/beat (added 2026-04-11 — previously silent-dropped on writes).
  -- Lets map layers and geofence reports locate FIs.
  section_id INTEGER,
  zone_id INTEGER,
  beat_id INTEGER,
  zone_beat TEXT,
  officer_id INTEGER NOT NULL,
  officer_name TEXT,
  status TEXT DEFAULT 'active',
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (person_id) REFERENCES persons(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles_records(id)
);

CREATE INDEX IF NOT EXISTS idx_fi_number ON field_interviews(fi_number);
CREATE INDEX IF NOT EXISTS idx_fi_person ON field_interviews(person_id);
CREATE INDEX IF NOT EXISTS idx_fi_officer ON field_interviews(officer_id);
CREATE INDEX IF NOT EXISTS idx_fi_property ON field_interviews(property_id);
CREATE INDEX IF NOT EXISTS idx_fi_status ON field_interviews(status);
CREATE INDEX IF NOT EXISTS idx_fi_archived ON field_interviews(archived_at);
CREATE INDEX IF NOT EXISTS idx_fi_created ON field_interviews(created_at);
CREATE INDEX IF NOT EXISTS idx_fi_date ON field_interviews(date);
-- Compound index for the "by location bbox" query: location-bounded
-- + within-date-range. Covers the common map-layer fetch.
CREATE INDEX IF NOT EXISTS idx_fi_lat_lng_date ON field_interviews(latitude, longitude, date);
