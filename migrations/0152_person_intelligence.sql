CREATE TABLE IF NOT EXISTS person_intelligence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_seed TEXT NOT NULL,
  subject_name TEXT,
  subject_dob TEXT,
  subject_photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  phase INTEGER NOT NULL DEFAULT 0,
  phase1_completed_at TEXT,
  phase2_completed_at TEXT,
  phase3_completed_at TEXT,
  risk_score REAL DEFAULT 0,
  risk_flags TEXT,
  linked_person_id INTEGER,
  sources_queried INTEGER DEFAULT 0,
  sources_succeeded INTEGER DEFAULT 0,
  data_points_found INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL,
  org_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS person_intel_data_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  sources TEXT NOT NULL,
  confidence REAL NOT NULL,
  verified_by INTEGER DEFAULT 0,
  officer_note TEXT,
  officer_flagged INTEGER DEFAULT 0,
  promoted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS person_intel_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER NOT NULL,
  from_subject TEXT NOT NULL,
  relationship TEXT NOT NULL,
  to_subject TEXT NOT NULL,
  to_subject_dossier_id INTEGER,
  confidence REAL NOT NULL,
  sources TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS person_intel_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  phase INTEGER NOT NULL,
  status TEXT NOT NULL,
  response_time_ms INTEGER,
  data_points_found INTEGER DEFAULT 0,
  error_message TEXT,
  queried_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pid_dossier ON person_intel_data_points(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pic_dossier ON person_intel_connections(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pis_dossier ON person_intel_sources(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pi_linked_person ON person_intelligence(linked_person_id);
CREATE INDEX IF NOT EXISTS idx_pi_status ON person_intelligence(status);
