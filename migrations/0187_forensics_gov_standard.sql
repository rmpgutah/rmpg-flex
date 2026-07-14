-- ============================================================
-- 0187_forensics_gov_standard.sql
-- ============================================================
-- Forensics government-standard follow-up to 0029_forensics.sql:
-- tamper-evident exhibit hashing, RMS cross-links, formalized QC,
-- and report/analysis templates. See
-- docs/superpowers/specs/2026-07-13-forensics-government-standard-design.md
-- ============================================================

-- ── forensic_exhibit_hashes — append-only hash history per exhibit ──
-- Never UPDATE a row. Re-verifying inserts a new purpose='reverify' row;
-- the API layer compares it against the most recent same-algorithm row
-- and sets mismatch=1 if they differ. This history IS the tamper
-- evidence — overwriting hash_md5/hash_sha256 on forensic_exhibits
-- (as the original MVP did) destroys exactly the evidence a re-hash is
-- supposed to produce.
CREATE TABLE IF NOT EXISTS forensic_exhibit_hashes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forensic_case_id INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
  exhibit_id INTEGER NOT NULL REFERENCES forensic_exhibits(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL CHECK(algorithm IN ('md5','sha1','sha256')),
  hash_value TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'intake' CHECK(purpose IN ('intake','reverify')),
  file_name TEXT,
  mismatch INTEGER NOT NULL DEFAULT 0,
  computed_by INTEGER REFERENCES users(id),
  computed_by_name TEXT,
  computed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_forensic_exhibit_hashes_exhibit ON forensic_exhibit_hashes(exhibit_id);
CREATE INDEX IF NOT EXISTS idx_forensic_exhibit_hashes_case ON forensic_exhibit_hashes(forensic_case_id);

-- ── forensic_case_links — cross-references to other RMS entities ──
-- Same shape/spirit as the app-wide `record_links` table, scoped to
-- forensic cases so it can be queried the same way `record_links` is
-- queried in src/routes/connections.ts.
CREATE TABLE IF NOT EXISTS forensic_case_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forensic_case_id INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  entity_label TEXT,
  relationship TEXT NOT NULL DEFAULT 'related',
  linked_by INTEGER REFERENCES users(id),
  linked_by_name TEXT,
  linked_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(forensic_case_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_forensic_case_links_case ON forensic_case_links(forensic_case_id);

-- ── forensic_qc_checks — formal QC record (ISO-17025/ANAB-style) ──
-- Previously QC checks were written into the generic `activity_log`
-- table with a JSON-stringified `details` blob the frontend couldn't
-- reliably parse (checked `details?.includes('PASS')` against JSON —
-- never matched). A dedicated table is also what accreditation
-- standards expect: QC is its own auditable record, not folded into
-- generic activity.
CREATE TABLE IF NOT EXISTS forensic_qc_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forensic_case_id INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
  exhibit_id INTEGER REFERENCES forensic_exhibits(id) ON DELETE SET NULL,
  check_type TEXT NOT NULL,
  reviewer_id INTEGER REFERENCES users(id),
  reviewer_name TEXT,
  pass INTEGER NOT NULL DEFAULT 1,
  reviewer_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_forensic_qc_checks_case ON forensic_qc_checks(forensic_case_id);

-- ── Report + analysis templates ──
-- GET /forensics/templates/report and GET /forensics/analysis-templates
-- already exist in src/routes/forensics.ts and query these exact table
-- names — they've been 404-ing to an empty array because the tables
-- were never created in any prior migration.
CREATE TABLE IF NOT EXISTS forensic_report_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  case_type TEXT,
  sections TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS forensic_analysis_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  case_type TEXT,
  analysis_type TEXT NOT NULL,
  methodology TEXT,
  equipment_used TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── forensic_cases new columns ──
-- metadata: generic per-case JSON bag. ForensicLabPage.tsx's
-- parseMeta()/saveMetadata() already read/write this field name via
-- PUT /forensic-lab/:id — the column has just never existed, so every
-- imaging-metadata save has been silently failing (see plan Task 1
-- discovery note). D1 has no ADD COLUMN IF NOT EXISTS; per CLAUDE.md
-- this is expected to error harmlessly on re-apply.
ALTER TABLE forensic_cases ADD COLUMN metadata TEXT DEFAULT '{}';

-- report_sections: JSON section list applied from a report template via
-- POST /forensic-lab/:caseId/apply-template (Task 5), read by
-- generateForensicCasePdf() to render a structured layout.
ALTER TABLE forensic_cases ADD COLUMN report_sections TEXT;

-- ── Starter templates so the tabs aren't empty on first deploy ──
INSERT INTO forensic_report_templates (name, case_type, sections) VALUES
  ('Standard DNA Report', 'general', '[{"key":"summary","label":"Case Summary"},{"key":"exhibits","label":"Exhibit Inventory"},{"key":"methodology","label":"Methodology"},{"key":"results","label":"Results"},{"key":"conclusion","label":"Conclusion"}]'),
  ('Digital Forensics Imaging Report', 'digital', '[{"key":"summary","label":"Case Summary"},{"key":"imaging","label":"Acquisition & Imaging"},{"key":"exhibits","label":"Exhibit Inventory"},{"key":"analysis","label":"Analysis Findings"},{"key":"conclusion","label":"Conclusion"}]');

INSERT INTO forensic_analysis_templates (name, case_type, analysis_type, methodology, equipment_used) VALUES
  ('Standard DNA Extraction & Profiling', 'general', 'dna', 'STR profiling per standard operating procedure', 'Genetic analyzer'),
  ('Digital Forensics Imaging', 'digital', 'digital_forensics', 'Forensic bit-for-bit disk image with write-blocker; hash verification pre/post', 'Write-blocker, forensic imaging workstation');
