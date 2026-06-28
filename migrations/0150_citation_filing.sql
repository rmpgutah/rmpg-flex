-- ============================================================
-- 0150_citation_filing.sql
-- ============================================================
-- Citation Utah Master Form rebuild (PR 1 of 7) — adds filing
-- pipeline + signature audit + per-zone court routing without
-- ALTERing the existing `citations` table (which is at ~70 cols
-- and we want to stay clear of D1's 100-col cap, gotcha #13).
--
-- Four new tables:
--   citation_signatures        — one row per sig event (tablet/QR/refused)
--   citation_filing            — 1:1 with citations, R2 keys + lifecycle
--   citation_filing_batches    — weekly auto-seal batches per court
--   agency_court_zones         — per-zone court + plaintiff/agency identity
--
-- All idempotent (CREATE TABLE IF NOT EXISTS). Apply via
-- `scripts/apply-migration.sh 0150_citation_filing.sql` directly to
-- live D1 (785de7ae) after merge — deploy step is continue-on-error
-- (gotcha #5).
-- ============================================================

-- ── citation_signatures ───────────────────────────────────────
-- One row per signature *event*. A single citation may have multiple:
-- QR sent → expires → officer retries → finally signed → audit trail
-- preserved. Refused signing is also a first-class row (method='refused').
CREATE TABLE IF NOT EXISTS citation_signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  citation_id INTEGER NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('tablet','qr','refused')),
  status TEXT NOT NULL CHECK(status IN ('pending','signed','expired','cancelled')) DEFAULT 'pending',
  signature_url TEXT,                  -- R2 key for PNG; NULL when refused
  signed_at TEXT,
  expires_at TEXT,                     -- QR token TTL (default 10 min from creation)
  token TEXT,                          -- 32-char random for public sign URL
  signed_by_name TEXT,                 -- self-attested by defendant on sign page
  ip TEXT,                             -- audit, QR only
  user_agent TEXT,                     -- audit, QR only
  geo_lat REAL,                        -- audit, QR + browser-geo permission
  geo_lng REAL,
  refusal_reason TEXT,                 -- when method='refused'
  officer_id INTEGER,                  -- officer who initiated the sig request
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE,
  FOREIGN KEY (officer_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_citation_signatures_citation ON citation_signatures(citation_id);
CREATE INDEX IF NOT EXISTS idx_citation_signatures_token ON citation_signatures(token);
CREATE INDEX IF NOT EXISTS idx_citation_signatures_status ON citation_signatures(status);

-- ── citation_filing ───────────────────────────────────────────
-- 1:1 with citations. Holds the four R2 PDF keys + the lifecycle state
-- of the court submission. Created when the officer hits Save (status
-- pending), advanced on Friday by the auto-seal cron (queued), advanced
-- by admin on Monday (filed).
CREATE TABLE IF NOT EXISTS citation_filing (
  citation_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending','queued','filed','voided')) DEFAULT 'pending',
  -- R2 keys; e.g., 'citations/123/defendant.pdf'
  defendant_copy_url TEXT,
  court_copy_url TEXT,
  agency_copy_url TEXT,
  file_copy_url TEXT,
  -- Filing batch reference (set when status moves pending → queued)
  batch_id INTEGER,
  filed_at TEXT,
  filed_by INTEGER,
  generated_at TEXT,                   -- timestamp the 4 copies first hit R2
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES citation_filing_batches(id),
  FOREIGN KEY (filed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_citation_filing_status ON citation_filing(status);
CREATE INDEX IF NOT EXISTS idx_citation_filing_batch ON citation_filing(batch_id);

-- ── citation_filing_batches ───────────────────────────────────
-- Weekly auto-seal batches per court. Status flow:
--   open      — Friday auto-seal just created it; still accepting late additions
--   sealed    — admin sealed it (or 72h elapsed); locked for editing
--   submitted — admin marked it as sent to court (with tracking number)
--   accepted  — court returned confirmation
--   rejected  — court rejected; children flip back to citation_filing.status='pending'
CREATE TABLE IF NOT EXISTS citation_filing_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_number TEXT NOT NULL UNIQUE,           -- "BATCH-2026-W26-SLCJC"
  court_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','sealed','submitted','accepted','rejected')) DEFAULT 'open',
  citation_count INTEGER DEFAULT 0,
  total_fine REAL DEFAULT 0,
  -- Export artifacts (R2 keys, generated on Export action)
  zip_url TEXT,
  manifest_url TEXT,
  exported_at TEXT,
  exported_by INTEGER,
  -- Court submission tracking
  submitted_at TEXT,
  submission_method TEXT,                       -- 'mail' | 'in-person' | 'efile'
  tracking_number TEXT,                         -- USPS, ECF receipt, etc.
  accepted_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (exported_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_citation_filing_batches_status ON citation_filing_batches(status);
CREATE INDEX IF NOT EXISTS idx_citation_filing_batches_court ON citation_filing_batches(court_name);

-- ── agency_court_zones ────────────────────────────────────────
-- Per-zone court routing + plaintiff/agency identity. Indexed by
-- citation.zone_id at issue time. Plaintiff/agency-ID configurable so
-- a RMPG-deputized zone can show "STATE OF UTAH" as plaintiff while a
-- purely-private HOA contract zone shows "ROCKY MOUNTAIN PROTECTIVE GROUP".
CREATE TABLE IF NOT EXISTS agency_court_zones (
  zone_id TEXT PRIMARY KEY,
  court_name TEXT NOT NULL,
  court_address TEXT,
  mandatory_appearance_default INTEGER DEFAULT 0,
  -- Identity fields stamped on the Utah master form for this zone's citations:
  plaintiff_name TEXT,                          -- 'STATE OF UTAH' or agency name
  agency_id_label TEXT,                         -- 'ORI: UT0XXXXXX' or 'License #: ...'
  include_court_caption INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

-- Workspace default seed: most RMPG zones route to the West Jordan branch
-- of the Salt Lake County Justice Court. Per-zone overrides can be added
-- via the admin UI (PR 3).
INSERT OR IGNORE INTO agency_court_zones
  (zone_id, court_name, court_address, mandatory_appearance_default, plaintiff_name, agency_id_label, include_court_caption)
VALUES
  ('__default__',
   'Salt Lake County Justice Court — West Jordan',
   '8080 South Redwood Road, West Jordan, UT 84088',
   0,
   'ROCKY MOUNTAIN PROTECTIVE GROUP',
   'License #: __________',
   1);
