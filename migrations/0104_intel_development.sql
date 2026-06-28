-- 0104: Intel v2 Wave 1 — Intelligence Development Cycle.
-- Raw reports → Admiralty 5×5×5 grade → sanitized products → dissemination,
-- plus a source/CI registry and 28 CFR Part 23 retention metadata.
-- Spec: docs/superpowers/specs/2026-06-13-intel-development-cycle-design.md
-- ⚠️ Apply directly to live D1 (785de7ae) after merge — deploy-time
-- migration apply is continue-on-error. Idempotent DDL.

CREATE TABLE IF NOT EXISTS intel_reports (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  report_number       TEXT,
  title               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'submitted',
  source_id           INTEGER,
  source_type         TEXT,
  source_reliability  TEXT,
  info_credibility    INTEGER,
  handling_code       TEXT,
  raw_narrative       TEXT,
  sanitized_narrative TEXT,
  assessment          TEXT,
  threat_level        TEXT DEFAULT 'low',
  classification      TEXT,
  criminal_predicate  TEXT,
  submitted_by        INTEGER,
  submitted_at        TEXT DEFAULT (datetime('now')),
  evaluated_by        INTEGER,
  evaluated_at        TEXT,
  analyzed_by         INTEGER,
  analyzed_at         TEXT,
  disseminated_by     INTEGER,
  disseminated_at     TEXT,
  review_date         TEXT,
  retention_status    TEXT DEFAULT 'active',
  rejected_reason     TEXT,
  recalled_reason     TEXT,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intel_reports_number ON intel_reports(report_number);
CREATE INDEX IF NOT EXISTS idx_intel_reports_status ON intel_reports(status);
CREATE INDEX IF NOT EXISTS idx_intel_reports_retention ON intel_reports(retention_status);
CREATE INDEX IF NOT EXISTS idx_intel_reports_threat ON intel_reports(threat_level);
CREATE INDEX IF NOT EXISTS idx_intel_reports_submitter ON intel_reports(submitted_by);
CREATE INDEX IF NOT EXISTS idx_intel_reports_source ON intel_reports(source_id);

CREATE TABLE IF NOT EXISTS intel_sources (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  source_code             TEXT,
  source_type             TEXT NOT NULL,
  display_label           TEXT,
  true_identity_person_id INTEGER,
  handler_user_id         INTEGER,
  reliability_grade       TEXT,
  status                  TEXT DEFAULT 'active',
  restricted              INTEGER DEFAULT 1,
  notes_restricted        TEXT,
  created_by              INTEGER,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intel_sources_code ON intel_sources(source_code);
CREATE INDEX IF NOT EXISTS idx_intel_sources_type ON intel_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_intel_sources_status ON intel_sources(status);

CREATE TABLE IF NOT EXISTS intel_source_reliability_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id  INTEGER NOT NULL,
  old_grade  TEXT,
  new_grade  TEXT,
  reason     TEXT,
  changed_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intel_srl_source ON intel_source_reliability_log(source_id);

CREATE TABLE IF NOT EXISTS intel_report_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id   INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  role        TEXT,
  added_by    INTEGER,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE (report_id, entity_type, entity_id, role)
);
CREATE INDEX IF NOT EXISTS idx_intel_report_links_report ON intel_report_links(report_id);
CREATE INDEX IF NOT EXISTS idx_intel_report_links_entity ON intel_report_links(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS intel_dissemination_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       INTEGER NOT NULL,
  recipient_type  TEXT,
  recipient_id    INTEGER,
  recipient_label TEXT,
  channel         TEXT,
  handling_ack    INTEGER DEFAULT 0,
  reason          TEXT,
  disseminated_by INTEGER,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intel_dissem_report ON intel_dissemination_log(report_id);
