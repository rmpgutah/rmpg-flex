-- ============================================================
-- 0032_court_events.sql
-- ============================================================
-- Court date tracking, subpoena management, case outcomes.
-- Single-table design — subpoenas are stored as court_events
-- with event_type='subpoena' (legacy pattern preserved).
--
-- Column set is the FULL evolved schema (initial CREATE + every
-- legacy addCol() boot-patch consolidated). D1 has no runtime
-- boot reconciler, so the migration must enumerate everything.
-- ============================================================

CREATE TABLE IF NOT EXISTS court_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_number TEXT UNIQUE NOT NULL,         -- e.g. CRT-2026-00042
  event_type TEXT NOT NULL CHECK(event_type IN (
    'arraignment','pretrial','trial','sentencing','hearing',
    'subpoena','status_conference','motion','plea','review','other'
  )),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN (
    'scheduled','confirmed','continued','completed','cancelled','no_show'
  )),
  event_date TEXT NOT NULL,
  event_time TEXT,
  court_name TEXT,
  courtroom TEXT,
  judge_name TEXT,
  court_case_number TEXT,
  citation_id INTEGER REFERENCES citations(id),
  incident_id INTEGER REFERENCES incidents(id),
  case_id INTEGER REFERENCES cases(id),
  defendant_person_id INTEGER REFERENCES persons(id),
  defendant_name TEXT,
  defendant_dob TEXT,
  prosecutor TEXT,
  prosecutor_phone TEXT,
  prosecutor_email TEXT,
  defense_attorney TEXT,
  officers_required TEXT NOT NULL DEFAULT '[]',  -- JSON array of officer IDs / names
  officer_confirmations TEXT NOT NULL DEFAULT '{}', -- JSON map officer_id -> bool
  outcome TEXT,
  verdict TEXT,
  sentence TEXT,
  fine_amount REAL,
  bail_amount REAL,
  bond_status TEXT,
  surety_info TEXT,
  court_fees TEXT NOT NULL DEFAULT '{}',         -- JSON map fee_type -> amount
  continuance_count INTEGER NOT NULL DEFAULT 0,
  continuance_log TEXT NOT NULL DEFAULT '[]',    -- JSON array of {at, to_date, reason, by}
  documents TEXT NOT NULL DEFAULT '[]',          -- JSON array of attachment IDs / refs
  witnesses TEXT NOT NULL DEFAULT '[]',          -- JSON array of {name, role, phone, ...}
  judge_notes TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_court_events_number ON court_events(event_number);
CREATE INDEX IF NOT EXISTS idx_court_events_status ON court_events(status);
CREATE INDEX IF NOT EXISTS idx_court_events_date ON court_events(event_date);
CREATE INDEX IF NOT EXISTS idx_court_events_type ON court_events(event_type);
CREATE INDEX IF NOT EXISTS idx_court_events_citation ON court_events(citation_id);
CREATE INDEX IF NOT EXISTS idx_court_events_case ON court_events(case_id);
CREATE INDEX IF NOT EXISTS idx_court_events_defendant ON court_events(defendant_person_id);
