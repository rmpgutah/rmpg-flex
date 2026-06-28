-- ============================================================
-- 0029_forensics.sql
-- ============================================================
-- Forensics — lab case management with chain-of-custody. Phase 1 RMS.
-- MVP scope: 4 tables covering core workflow (case → exhibit →
-- analysis → audit).
--
-- Deferred to follow-up PRs (separate migrations):
--   - forensic_hash_sets / forensic_hash_entries / forensic_hash_results
--     (anti-evidence-tampering hash verification, ~3 tables + 4 endpoints)
--   - forensic_case_links (cross-references to incidents/cases/people,
--     ~1 table + 3 endpoints — needs same junction pattern as cases)
--   - Report templates / QC history (likely JSON columns on
--     forensic_cases or separate tables; needs audit)
--
-- The MVP covers the lab-tech daily workflow: receive a case, log
-- exhibits with chain-of-custody, run analyses, audit the trail.
-- Reports and hash verification are operational layers on top.
-- ============================================================

-- ── forensic_cases — the case header ──
-- CHECK constraints mirror legacy; safe because D1 enforces them.
CREATE TABLE IF NOT EXISTS forensic_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_number TEXT UNIQUE NOT NULL,         -- auto-generated FOR-YYYY-NNNN
  case_type TEXT NOT NULL DEFAULT 'general' CHECK(case_type IN (
    'general','homicide','sexual_assault','narcotics','arson','fraud',
    'burglary','robbery','digital','traffic','cold_case','other'
  )),
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN (
    'received','in_progress','analysis_complete','report_drafted',
    'reviewed','released','cancelled'
  )),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN (
    'routine','normal','rush','urgent'
  )),
  title TEXT NOT NULL,
  description TEXT,
  requesting_agency TEXT DEFAULT 'RMPG',
  requesting_officer TEXT,
  lead_examiner_id INTEGER REFERENCES users(id),
  -- Cross-references to other RMS entities (FK kept loose; the
  -- *_number columns are denormalized for display without a JOIN)
  linked_incident_id INTEGER REFERENCES incidents(id),
  linked_case_id INTEGER REFERENCES cases(id),
  linked_incident_number TEXT,
  linked_case_number TEXT,
  received_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  due_date TEXT,
  completed_date TEXT,
  released_date TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_forensic_cases_status ON forensic_cases(status);
CREATE INDEX IF NOT EXISTS idx_forensic_cases_lab ON forensic_cases(lab_number);
CREATE INDEX IF NOT EXISTS idx_forensic_cases_priority ON forensic_cases(priority);
CREATE INDEX IF NOT EXISTS idx_forensic_cases_examiner ON forensic_cases(lead_examiner_id);
CREATE INDEX IF NOT EXISTS idx_forensic_cases_received ON forensic_cases(received_date);

-- ── forensic_exhibits — physical/digital items with chain-of-custody ──
-- chain_of_custody is a JSON array; transfers append entries via the
-- POST /:caseId/exhibits/:exhibitId/custody endpoint. Hash columns
-- (md5/sha256) support digital-evidence integrity checks.
CREATE TABLE IF NOT EXISTS forensic_exhibits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forensic_case_id INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
  exhibit_number TEXT NOT NULL,            -- per-case, e.g. E-001, E-002
  exhibit_type TEXT NOT NULL DEFAULT 'other' CHECK(exhibit_type IN (
    'biological','chemical','digital','document','drug','explosive',
    'fingerprint','firearm','trace','clothing','dna_sample','tool_mark',
    'glass','paint','fiber','soil','impression','other'
  )),
  description TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  condition_received TEXT,
  storage_location TEXT,
  storage_temp TEXT,                       -- 'ambient' | 'refrigerated' | 'frozen' | etc
  collected_by TEXT,
  collected_date TEXT,
  collection_method TEXT,
  hash_md5 TEXT,
  hash_sha256 TEXT,
  chain_of_custody TEXT DEFAULT '[]',      -- JSON array of {at, from, to, reason, by_id}
  disposition TEXT DEFAULT 'in_lab' CHECK(disposition IN (
    'in_lab','returned','destroyed','transferred','in_storage'
  )),
  disposition_date TEXT,
  disposition_notes TEXT,
  photos TEXT DEFAULT '[]',                -- JSON array of attachment IDs
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(forensic_case_id, exhibit_number)
);

CREATE INDEX IF NOT EXISTS idx_forensic_exhibits_case ON forensic_exhibits(forensic_case_id);
CREATE INDEX IF NOT EXISTS idx_forensic_exhibits_type ON forensic_exhibits(exhibit_type);
CREATE INDEX IF NOT EXISTS idx_forensic_exhibits_disposition ON forensic_exhibits(disposition);

-- ── forensic_analyses — lab work on exhibits ──
-- exhibit_id ON DELETE SET NULL — analysis records persist even if the
-- underlying exhibit is removed (audit trail outlives the evidence).
CREATE TABLE IF NOT EXISTS forensic_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forensic_case_id INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
  exhibit_id INTEGER REFERENCES forensic_exhibits(id) ON DELETE SET NULL,
  analysis_type TEXT NOT NULL CHECK(analysis_type IN (
    'dna','fingerprint','drug_analysis','toxicology','ballistics',
    'digital_forensics','document_exam','trace_evidence','serology',
    'arson_analysis','tool_mark','glass_analysis','paint_analysis',
    'fiber_analysis','blood_spatter','gunshot_residue','other'
  )),
  methodology TEXT,
  equipment_used TEXT,
  examiner_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending','in_progress','completed','inconclusive','cancelled'
  )),
  started_at TEXT,
  completed_at TEXT,
  results TEXT,
  conclusion TEXT,
  limitations TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_forensic_analyses_case ON forensic_analyses(forensic_case_id);
CREATE INDEX IF NOT EXISTS idx_forensic_analyses_exhibit ON forensic_analyses(exhibit_id);
CREATE INDEX IF NOT EXISTS idx_forensic_analyses_status ON forensic_analyses(status);
CREATE INDEX IF NOT EXISTS idx_forensic_analyses_examiner ON forensic_analyses(examiner_id);

-- ── forensic_activity_log — audit trail (immutable append-only) ──
-- Every meaningful action (case create, exhibit add, custody transfer,
-- analysis status change, etc) appends here. Read via GET /:caseId/activity
-- and GET /:caseId/exhibits/:exhibitId/custody-audit.
CREATE TABLE IF NOT EXISTS forensic_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forensic_case_id INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
  exhibit_id INTEGER REFERENCES forensic_exhibits(id),
  action TEXT NOT NULL,                    -- 'case_created' | 'exhibit_added' | 'custody_transferred' | etc
  details TEXT,                            -- free-text or JSON-stringified context
  performed_by INTEGER REFERENCES users(id),
  performed_by_name TEXT,
  performed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_forensic_activity_case ON forensic_activity_log(forensic_case_id);
CREATE INDEX IF NOT EXISTS idx_forensic_activity_exhibit ON forensic_activity_log(exhibit_id);
CREATE INDEX IF NOT EXISTS idx_forensic_activity_when ON forensic_activity_log(performed_at);
