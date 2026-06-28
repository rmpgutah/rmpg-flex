-- ============================================================
-- 0028_cases.sql
-- ============================================================
-- Cases — investigative case management. Phase 1 RMS, core CRUD +
-- workflow + notes + person attach.
--
-- Junction tables for the OTHER linked entities (incidents,
-- evidence, vehicles, properties, warrants, citations, calls)
-- are intentionally deferred to a follow-up PR — that's ~6 junction
-- tables + 18 endpoints (GET/POST/DELETE × 6), each following the
-- same shape as case_person_links here. Cluster as one PR so the
-- review can focus on the junction pattern.
--
-- The cases.linked_{incidents,citations,evidence,persons,
-- field_interviews,calls} JSON columns remain in the schema for
-- legacy compatibility — they're populated by older code paths.
-- Task 3.2 of the Connections Analyst Tool work was a backfill
-- from these arrays into the junction tables; the follow-up PR
-- ports that migration helper as POST /migrate-json-to-junctions.
-- ============================================================

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  case_type TEXT DEFAULT 'general',
  status TEXT DEFAULT 'open',           -- open|under_review|approved|closed
  priority TEXT DEFAULT 'normal',       -- low|normal|high|critical
  lead_investigator_id INTEGER,
  assigned_officers TEXT DEFAULT '[]',  -- JSON array of user IDs
  assigned_at TEXT,
  solvability_score INTEGER DEFAULT 0,
  solvability_factors TEXT DEFAULT '{}', -- JSON object — per-factor score breakdown
  -- Legacy JSON link columns (kept for backward-compat with older
  -- frontends; the junction tables are the source of truth going
  -- forward, but populating both keeps the contract intact)
  linked_incidents TEXT DEFAULT '[]',
  linked_citations TEXT DEFAULT '[]',
  linked_evidence TEXT DEFAULT '[]',
  linked_persons TEXT DEFAULT '[]',
  linked_field_interviews TEXT DEFAULT '[]',
  linked_calls TEXT DEFAULT '[]',       -- via addCol in legacy
  summary TEXT,
  narrative TEXT,
  disposition TEXT,
  disposition_date TEXT,
  opened_date TEXT DEFAULT (datetime('now','localtime')),
  due_date TEXT,
  deadline TEXT,                        -- legacy alias used by some clients
  sla_hours INTEGER,
  closed_date TEXT,
  -- Civil-case fields (added via addCol; only populated for civil
  -- case_type, not criminal/general)
  court_case_number TEXT,
  court_id INTEGER,
  plaintiff_person_id INTEGER,
  defendant_person_id INTEGER,
  attorney_person_id INTEGER,
  signed_filed_date TEXT,
  response_deadline_days INTEGER,
  amount_demanded REAL,
  cause_of_action TEXT,
  -- Workflow audit
  audit_log TEXT DEFAULT '[]',          -- JSON array of {at, by, action, note}
  assigned_employees TEXT DEFAULT '[]', -- duplicated from assigned_officers in legacy
  -- Standard audit
  created_by INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  archived_at TEXT,
  FOREIGN KEY (lead_investigator_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_cases_number ON cases(case_number);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases(priority);
CREATE INDEX IF NOT EXISTS idx_cases_lead ON cases(lead_investigator_id);
CREATE INDEX IF NOT EXISTS idx_cases_created_by ON cases(created_by);
CREATE INDEX IF NOT EXISTS idx_cases_archived ON cases(archived_at);
CREATE INDEX IF NOT EXISTS idx_cases_opened ON cases(opened_date);

-- Notes — pinnable per-case notes, ordered newest first by default
CREATE TABLE IF NOT EXISTS case_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  author_name TEXT,
  note_type TEXT DEFAULT 'general',     -- general|investigative|legal|disposition
  content TEXT NOT NULL,
  is_pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_case_notes_case ON case_notes(case_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_pinned ON case_notes(case_id, is_pinned);

-- Persons junction — first of the six junction tables. Others
-- (incidents, evidence, vehicles, properties, warrants, citations,
-- calls) deferred to the junction follow-up PR.
CREATE TABLE IF NOT EXISTS case_person_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  relationship TEXT DEFAULT 'linked',   -- linked|suspect|victim|witness|reporter|defendant|plaintiff
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(case_id, person_id),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cpl_case ON case_person_links(case_id);
CREATE INDEX IF NOT EXISTS idx_cpl_person ON case_person_links(person_id);
