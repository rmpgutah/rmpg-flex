-- Person Intelligence — cross-reference capture & verification (2026-08-25).
-- Extends the 0152 schema to integrate six reference repositories:
--   WebOlivia/skip-trace + GautaVaid/Skip_Tracing (skip-trace profile),
--   freelawproject/juriscraper + courtlistener (court records),
--   freelawproject/centralia (opinion extraction),
--   Premasajjanar/Criminal_database_management_system (criminal cross-ref).
-- All DDL idempotent (IF NOT EXISTS). Apply via scripts/apply-migration.sh.

-- ─── Cross-reference capture ─────────────────────────────────────
-- One row per (dossier, source, external_ref). Re-running a phase upserts
-- rather than duplicating, so confidence/label stay current.
CREATE TABLE IF NOT EXISTS person_intel_cross_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER NOT NULL,
  source TEXT NOT NULL,                 -- COURTLISTENER | FBI_WANTED | CRIMINAL_DB | SKIP_TRACE | INTERNAL
  external_ref TEXT NOT NULL,           -- docket number / bulletin url / case id / profile url
  external_url TEXT,
  label TEXT NOT NULL,                   -- case caption / bulletin title / profile name
  matched_fields TEXT NOT NULL DEFAULT '[]',  -- JSON [{field,value}]
  confidence REAL NOT NULL DEFAULT 0,
  is_criminal INTEGER NOT NULL DEFAULT 0,
  risk_flags TEXT NOT NULL DEFAULT '[]', -- JSON []
  verified_result TEXT,                 -- confirmed | rejected | inconclusive (set on verify)
  captured_by INTEGER,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (dossier_id, source, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_picr_dossier ON person_intel_cross_refs(dossier_id);
CREATE INDEX IF NOT EXISTS idx_picr_dossier_criminal ON person_intel_cross_refs(dossier_id, is_criminal);

-- ─── Verification ────────────────────────────────────────────────
-- Officer-supplied evidence for a captured cross-ref + the computed verdict.
CREATE TABLE IF NOT EXISTS person_intel_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cross_ref_id INTEGER NOT NULL REFERENCES person_intel_cross_refs(id) ON DELETE CASCADE,
  method TEXT NOT NULL,                 -- dob | address | phone | email | identifier | officer_review
  result TEXT NOT NULL,                 -- confirmed | rejected | inconclusive
  evidence TEXT NOT NULL DEFAULT '',
  verified_by INTEGER NOT NULL,
  adjusted_confidence REAL NOT NULL,
  notes TEXT,
  verified_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_piv_xref ON person_intel_verifications(cross_ref_id);

-- ─── centralia opinion extraction ────────────────────────────────
-- Stores a court-PDF opinion parsed into centralia's read() shape. Workers
-- cannot run the Python extractor; a client-side (Pyodide) or sidecar fill
-- the row, keyed by the stored R2 object + docket.
CREATE TABLE IF NOT EXISTS person_intel_opinions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER REFERENCES person_intelligence(id) ON DELETE SET NULL,
  court_id TEXT NOT NULL,                -- centralia court id (e.g. "mont")
  docket_number TEXT,
  r2_key TEXT,                           -- where the source PDF lives in UPLOADS
  status TEXT NOT NULL DEFAULT 'pending',-- pending | valid | review | scanned | failed
  extracted JSON,                        -- full CentraliaResult
  extracted_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pio_dossier ON person_intel_opinions(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pio_status ON person_intel_opinions(status);

-- ─── Dossier counter column ─────────────────────────────────────
-- person_intelligence (0152) has no cross_refs_found column. D1 cannot
-- IF-NOT-EXISTS an ADD COLUMN; the Worker boot reconciler tolerates its
-- absence (the UPDATE in crossReference.ts is wrapped so a missing column
-- degrades). Apply this ALTER directly to live D1 via apply-migration.sh;
-- on a duplicate-column error it is safe to ignore.
ALTER TABLE person_intelligence ADD COLUMN cross_refs_found INTEGER DEFAULT 0;
