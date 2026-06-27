-- ============================================================
-- RMPG Flex — Case Management Expansion
-- Migration 0155
-- Cross-Reference Engine + FTS5 search + Automation Rules +
-- MO Pattern Matching + Case Timeline Events
-- ============================================================

-- ── Case Timeline Events ─────────────────────────────────
CREATE TABLE IF NOT EXISTS case_timeline_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cte_case_id ON case_timeline_events(case_id);
CREATE INDEX IF NOT EXISTS idx_cte_event_type ON case_timeline_events(event_type);
CREATE INDEX IF NOT EXISTS idx_cte_created_at ON case_timeline_events(created_at);

-- ── Entity Cross-Reference Links ─────────────────────────
CREATE TABLE IF NOT EXISTS investigation_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  link_category TEXT NOT NULL DEFAULT 'related',
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_il_source ON investigation_links(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_il_target ON investigation_links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_il_category ON investigation_links(link_category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_il_unique ON investigation_links(source_type, source_id, target_type, target_id);

-- ── FTS5 Virtual Tables (content-synced) ─────────────────
-- Cases search: covers case_number, title, description, summary, narrative
CREATE VIRTUAL TABLE IF NOT EXISTS cases_fts USING fts5(
  case_number, title, description, summary, narrative,
  content='cases',
  content_rowid='id',
  tokenize='porter unicode61'
);

-- Persons search: covers name, address, identifiers
CREATE VIRTUAL TABLE IF NOT EXISTS persons_fts USING fts5(
  first_name, last_name, dob, phone, address,
  content='persons',
  content_rowid='id',
  tokenize='porter unicode61'
);

-- ── Triggers to keep FTS5 in sync with content tables ────
-- Cases
CREATE TRIGGER IF NOT EXISTS cases_ai AFTER INSERT ON cases BEGIN
  INSERT INTO cases_fts(rowid, case_number, title, description, summary, narrative)
  VALUES (new.id, new.case_number, new.title, new.description, new.summary, new.narrative);
END;

CREATE TRIGGER IF NOT EXISTS cases_ad AFTER DELETE ON cases BEGIN
  INSERT INTO cases_fts(cases_fts, rowid, case_number, title, description, summary, narrative)
  VALUES ('delete', old.id, old.case_number, old.title, old.description, old.summary, old.narrative);
END;

CREATE TRIGGER IF NOT EXISTS cases_au AFTER UPDATE ON cases BEGIN
  INSERT INTO cases_fts(cases_fts, rowid, case_number, title, description, summary, narrative)
  VALUES ('delete', old.id, old.case_number, old.title, old.description, old.summary, old.narrative);
  INSERT INTO cases_fts(rowid, case_number, title, description, summary, narrative)
  VALUES (new.id, new.case_number, new.title, new.description, new.summary, new.narrative);
END;

-- Persons
CREATE TRIGGER IF NOT EXISTS persons_ai AFTER INSERT ON persons BEGIN
  INSERT INTO persons_fts(rowid, first_name, last_name, dob, phone, address)
  VALUES (new.id, new.first_name, new.last_name, new.dob, new.phone, new.address);
END;

CREATE TRIGGER IF NOT EXISTS persons_ad AFTER DELETE ON persons BEGIN
  INSERT INTO persons_fts(persons_fts, rowid, first_name, last_name, dob, phone, address)
  VALUES ('delete', old.id, old.first_name, old.last_name, old.dob, old.phone, old.address);
END;

CREATE TRIGGER IF NOT EXISTS persons_au AFTER UPDATE ON persons BEGIN
  INSERT INTO persons_fts(persons_fts, rowid, first_name, last_name, dob, phone, address)
  VALUES ('delete', old.id, old.first_name, old.last_name, old.dob, old.phone, old.address);
  INSERT INTO persons_fts(rowid, first_name, last_name, dob, phone, address)
  VALUES (new.id, new.first_name, new.last_name, new.dob, new.phone, new.address);
END;

-- ── Automation Rule Configuration ────────────────────────
CREATE TABLE IF NOT EXISTS automation_rule_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  trigger_event TEXT NOT NULL,
  conditions TEXT NOT NULL DEFAULT '{}',
  actions TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  cooldown_minutes INTEGER DEFAULT 60,
  last_fired_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_arc_enabled ON automation_rule_config(enabled);
CREATE INDEX IF NOT EXISTS idx_arc_trigger ON automation_rule_config(trigger_event);

-- ── Automation Execution Log ─────────────────────────────
CREATE TABLE IF NOT EXISTS automation_execution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL,
  trigger_entity_type TEXT,
  trigger_entity_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (rule_id) REFERENCES automation_rule_config(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_aes_rule_id ON automation_execution_log(rule_id);
CREATE INDEX IF NOT EXISTS idx_aes_status ON automation_execution_log(status);
CREATE INDEX IF NOT EXISTS idx_aes_started ON automation_execution_log(started_at);

-- ── MO (Modus Operandi) Pattern Library ──────────────────
CREATE TABLE IF NOT EXISTS mo_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  attributes TEXT NOT NULL DEFAULT '{}',
  match_confidence REAL DEFAULT 0.5,
  created_by INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mp_category ON mo_patterns(category);
CREATE INDEX IF NOT EXISTS idx_mp_active ON mo_patterns(active);

-- ── Case–MO Match Results ────────────────────────────────
CREATE TABLE IF NOT EXISTS case_mo_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  pattern_id INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  match_details TEXT,
  reviewed INTEGER NOT NULL DEFAULT 0,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (pattern_id) REFERENCES mo_patterns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cmm_case_id ON case_mo_matches(case_id);
CREATE INDEX IF NOT EXISTS idx_cmm_pattern_id ON case_mo_matches(pattern_id);
CREATE INDEX IF NOT EXISTS idx_cmm_confidence ON case_mo_matches(confidence);

-- ── Seed: initial FTS5 content (rebuild for existing data) ──
INSERT INTO cases_fts(cases_fts) VALUES('rebuild');
INSERT INTO persons_fts(persons_fts) VALUES('rebuild');
