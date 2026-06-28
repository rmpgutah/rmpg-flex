-- 0106: Person-Screening framework — unified review queue + per-source caches.
-- ⚠️ Apply directly to live D1 (785de7ae) after merge (deploy step is continue-on-error).
-- Spec: docs/superpowers/specs/2026-06-13-person-screening-framework-design.md

CREATE TABLE IF NOT EXISTS screening_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  person_id INTEGER,
  external_id TEXT NOT NULL,
  match_score REAL DEFAULT 0,
  matched_fields TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  display_name TEXT,
  summary TEXT,
  photo_url TEXT,
  country TEXT,
  list_type TEXT,
  raw_json TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  promoted_ref TEXT,
  first_seen_at TEXT DEFAULT (datetime('now')),
  last_seen_at  TEXT DEFAULT (datetime('now')),
  is_active INTEGER DEFAULT 1
);
-- person_id is intentionally nullable; SQLite UNIQUE treats NULLs as distinct, so
-- dedup applies only to watch hits (person_id always set), not hypothetical ad-hoc rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_hits_uniq ON screening_hits(source_key, person_id, external_id);
CREATE INDEX IF NOT EXISTS idx_screening_hits_status ON screening_hits(status, is_active);
CREATE INDEX IF NOT EXISTS idx_screening_hits_person ON screening_hits(person_id);

CREATE TABLE IF NOT EXISTS screening_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  source_scope TEXT,
  reason TEXT,
  added_by INTEGER,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_screening_watch_person ON screening_watchlist(person_id, active);

CREATE TABLE IF NOT EXISTS screening_source_state (
  source_key TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  circuit_broken INTEGER DEFAULT 0,
  items_count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS screening_scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  persons_checked INTEGER DEFAULT 0,
  new_hits INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  note TEXT
);

CREATE TABLE IF NOT EXISTS interpol_notices (
  entity_id TEXT NOT NULL,
  notice_type TEXT NOT NULL,
  forename TEXT, name TEXT,
  date_of_birth TEXT,
  nationalities TEXT,
  sex_id TEXT,
  charges TEXT,
  thumbnail_url TEXT,
  raw_json TEXT,
  fetched_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (notice_type, entity_id)
);

CREATE TABLE IF NOT EXISTS ofac_sanctions (
  uid TEXT PRIMARY KEY,
  source_list TEXT,
  entity_type TEXT,
  name TEXT,
  alt_names TEXT,
  programs TEXT,
  addresses TEXT,
  dob TEXT,
  nationalities TEXT,
  remarks TEXT,
  raw_json TEXT,
  ingested_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ofac_name ON ofac_sanctions(name);

CREATE TABLE IF NOT EXISTS ofac_ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  rows_loaded INTEGER DEFAULT 0,
  source_url TEXT,
  error TEXT
);

INSERT OR IGNORE INTO screening_source_state (source_key, enabled) VALUES
  ('interpol-red', 1), ('interpol-yellow', 1), ('interpol-un', 1),
  ('ofac-csl', 1), ('utah-sor', 1);
