-- ============================================================
-- 0039_case_junction_tables.sql
-- ============================================================
-- Backport of the legacy worker's case junction tables to live D1.
--
-- Symptom: Opening a case detail page hits GET /api/cases/:id/full,
-- which the legacy `rmpg-flex` Worker (the only handler for this path —
-- new worker has no /full or sub-tab routes yet) services with a SELECT
-- per junction table. Live D1 was missing 8 of the 10 junction tables
-- (only `case_notes` + `case_person_links` had been created by
-- migration 0028), so each sub-tab 500'd with "no such table: case_X".
--
-- Schemas reproduced VERBATIM from legacy/server-vps/src/routes/cases.ts
-- (lines 586-674) and legacy/server-vps/src/models/database.ts
-- (lines 2776-2802). Reproducing exactly matters — the SELECTs in the
-- legacy /full handler reference specific columns (cp.person_name,
-- cp.role, cv.role, cpr.role, etc.) and any drift would still 500.
--
-- After this lands, empty tables degrade cleanly to empty arrays
-- on every sub-tab. Real link CRUD UI for these junctions is out of
-- scope for this PR; the rewrite of /api/cases/* will eventually
-- replace these handlers entirely.
-- ============================================================

-- ── case_persons ────────────────────────────────────────────
-- NOTE: distinct from `case_person_links` (created in 0028, used by
-- new worker). The legacy /full handler queries `case_persons` and
-- selects cp.* — including person_name + role + notes — so the new
-- table cannot be substituted without rewriting the legacy SELECT.
CREATE TABLE IF NOT EXISTS case_persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  person_id INTEGER,
  person_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'involved',
  notes TEXT,
  added_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_case_persons_case ON case_persons(case_id);

-- ── case_calls ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  call_id INTEGER NOT NULL,
  added_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (call_id) REFERENCES calls_for_service(id) ON DELETE CASCADE,
  UNIQUE(case_id, call_id)
);
CREATE INDEX IF NOT EXISTS idx_case_calls_case ON case_calls(case_id);

-- ── case_incidents ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  incident_id INTEGER NOT NULL,
  added_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  UNIQUE(case_id, incident_id)
);
CREATE INDEX IF NOT EXISTS idx_case_incidents_case ON case_incidents(case_id);

-- ── case_vehicles ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  role TEXT DEFAULT 'involved',
  notes TEXT,
  added_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  UNIQUE(case_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS idx_case_vehicles_case ON case_vehicles(case_id);

-- ── case_properties ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  property_id INTEGER NOT NULL,
  role TEXT DEFAULT 'scene',
  added_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  UNIQUE(case_id, property_id)
);
CREATE INDEX IF NOT EXISTS idx_case_properties_case ON case_properties(case_id);

-- ── case_evidence ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  evidence_id INTEGER NOT NULL,
  added_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  UNIQUE(case_id, evidence_id)
);
CREATE INDEX IF NOT EXISTS idx_case_evidence_case ON case_evidence(case_id);

-- ── case_warrants ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_warrants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  warrant_id INTEGER NOT NULL,
  added_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  UNIQUE(case_id, warrant_id)
);
CREATE INDEX IF NOT EXISTS idx_case_warrants_case ON case_warrants(case_id);

-- ── case_citations ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  citation_id INTEGER NOT NULL,
  added_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  UNIQUE(case_id, citation_id)
);
CREATE INDEX IF NOT EXISTS idx_case_citations_case ON case_citations(case_id);

-- ── case_incident_links ─────────────────────────────────────
-- Separate from case_incidents — the legacy PUT /:id handler writes
-- linked_incidents into this table (line 200, 274-275 of legacy
-- cases.ts) while the /full GET reads from case_incidents (line 889).
-- Both are needed for the legacy worker to round-trip without error.
CREATE TABLE IF NOT EXISTS case_incident_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  incident_id INTEGER NOT NULL,
  relationship TEXT DEFAULT 'linked',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(case_id, incident_id),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cil_case ON case_incident_links(case_id);
CREATE INDEX IF NOT EXISTS idx_cil_incident ON case_incident_links(incident_id);

-- ── case_evidence_links ─────────────────────────────────────
-- Sibling to case_incident_links — legacy PUT writes here (line 204,
-- 279-280); /full reads from case_evidence.
CREATE TABLE IF NOT EXISTS case_evidence_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  evidence_id INTEGER NOT NULL,
  relationship TEXT DEFAULT 'linked',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(case_id, evidence_id),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cel_case ON case_evidence_links(case_id);
CREATE INDEX IF NOT EXISTS idx_cel_evidence ON case_evidence_links(evidence_id);
