-- ============================================================
-- 0027_citations.sql
-- ============================================================
-- Citations (traffic / criminal / parking / warning) — Phase 1 RMS.
-- Three tables:
--   - citations           — header (subject, vehicle, statute, court)
--   - citation_violations — child for multi-violation citations
--   - citation_payments   — child for payment history
--
-- Legacy schema was extensively augmented at runtime via addCol().
-- This migration enumerates the full evolved column set (initial
-- CREATE plus 41 addCol entries) so the port works against a fresh D1.
--
-- Foreign keys reference utah_statutes(id) which is NOT enforced in
-- D1 (no such table yet — separate Phase 5 port). Listed as
-- REFERENCES for self-documentation; SQLite won't error on missing
-- referent without PRAGMA foreign_keys = ON.
-- ============================================================

CREATE TABLE IF NOT EXISTS citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  citation_number TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'traffic' CHECK(type IN ('traffic','criminal','parking','warning')),
  status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','paid','contested','dismissed','warrant_issued','voided')),
  -- Subject
  person_id INTEGER,
  person_name TEXT,
  person_dob TEXT,
  person_dl TEXT,
  person_address TEXT,
  -- Vehicle (added via addCol)
  vehicle_id INTEGER,
  vehicle_description TEXT,
  vehicle_plate TEXT,
  vehicle_state TEXT,
  vehicle_vin TEXT,
  vehicle_year TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  -- Violation summary (per-citation; details live in citation_violations
  -- when there's >1 violation per stop)
  statute_id INTEGER,
  statute_citation TEXT,
  violation_description TEXT,
  offense_level TEXT,
  fine_amount REAL,
  bond_amount REAL,
  bond_type TEXT,
  -- Speed-specific (traffic/radar)
  speed_recorded INTEGER,
  speed_limit INTEGER,
  radar_type TEXT,
  -- DUI/BAC
  bac_level REAL,
  -- Boolean flags (INTEGER 0/1)
  is_warning INTEGER DEFAULT 0,
  is_equipment_violation INTEGER DEFAULT 0,
  accident_related INTEGER DEFAULT 0,
  dui_related INTEGER DEFAULT 0,
  school_zone INTEGER DEFAULT 0,
  construction_zone INTEGER DEFAULT 0,
  commercial_vehicle INTEGER DEFAULT 0,
  hazmat INTEGER DEFAULT 0,
  -- Conditions
  weather_conditions TEXT,
  road_conditions TEXT,
  -- Location
  violation_date TEXT NOT NULL,
  violation_time TEXT,
  location TEXT,
  latitude REAL,
  longitude REAL,
  -- Spillman geography
  section_id TEXT,
  sector_id TEXT,
  zone_id TEXT,
  beat_id TEXT,
  zone_beat TEXT,
  -- Linkage
  incident_id INTEGER,
  call_id INTEGER,
  case_id INTEGER,
  -- Officer
  issuing_officer_id INTEGER,
  issuing_officer_name TEXT,
  badge_number TEXT,
  -- Court
  court_date TEXT,
  court_time TEXT,
  court_room TEXT,
  court_name TEXT,
  court_address TEXT,
  appearance_required INTEGER DEFAULT 0,
  -- Disposition (populated post-court)
  plea TEXT,
  verdict TEXT,
  sentence TEXT,
  disposition_date TEXT,
  -- Voiding
  voided_reason TEXT,
  voided_by INTEGER,
  voided_at TEXT,
  -- Notes
  notes TEXT,
  -- Audit
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (person_id) REFERENCES persons(id),
  FOREIGN KEY (incident_id) REFERENCES incidents(id),
  FOREIGN KEY (issuing_officer_id) REFERENCES users(id),
  FOREIGN KEY (voided_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_citations_number ON citations(citation_number);
CREATE INDEX IF NOT EXISTS idx_citations_status ON citations(status);
CREATE INDEX IF NOT EXISTS idx_citations_type ON citations(type);
CREATE INDEX IF NOT EXISTS idx_citations_violation_date ON citations(violation_date);
CREATE INDEX IF NOT EXISTS idx_citations_person ON citations(person_id);
CREATE INDEX IF NOT EXISTS idx_citations_officer ON citations(issuing_officer_id);
CREATE INDEX IF NOT EXISTS idx_citations_incident ON citations(incident_id);

-- Child: multi-violation support. A single stop with three offenses
-- gets one citations row + three citation_violations rows.
CREATE TABLE IF NOT EXISTS citation_violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  citation_id INTEGER NOT NULL,
  violation_number INTEGER NOT NULL DEFAULT 1,
  statute_id INTEGER,
  statute_citation TEXT,
  violation_description TEXT NOT NULL,
  offense_level TEXT DEFAULT 'infraction',
  fine_amount REAL DEFAULT 0,
  speed_recorded INTEGER,
  speed_limit INTEGER,
  plea TEXT,
  verdict TEXT,
  disposition TEXT,
  disposition_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_citation_violations_citation ON citation_violations(citation_id);

-- Child: payment history. Citations may have partial payments; the
-- /payment-summary endpoint aggregates total_paid vs fine_amount.
CREATE TABLE IF NOT EXISTS citation_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  citation_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  payment_date TEXT,
  payment_method TEXT,
  reference_number TEXT,
  notes TEXT,
  recorded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_citation_payments_citation ON citation_payments(citation_id);
