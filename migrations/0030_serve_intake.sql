-- ============================================================
-- 0030_serve_intake.sql
-- ============================================================
-- Process service queue — civil paper service tracking (subpoenas,
-- summons, eviction notices). Phase 1 MVP data layer.
--
-- Scope: 4 tables matching the legacy /server/ schema:
--   - serve_queue        — one row per paper to serve
--   - serve_attempts     — chronological log of service attempts
--   - serve_routes       — daily officer route plans
--   - serve_skip_traces  — address-search history per queue entry
--
-- Deferred (separate follow-up PRs — see legacy serveIntakeHelpers.ts,
-- serveIntakeEnrichment.ts, courtFormDetector.ts):
--   - PDF auto-parsing (court dockets, ServeManager field sheets) —
--     ~1300 LOC of regex parsers + OCR fallback. The documentIntake
--     + pdfTools container handle text extraction; parser port is
--     blocked on that pipeline being end-to-end first.
--   - ServeManager poller integration
--   - Auto-diligence schedule computation
-- ============================================================

CREATE TABLE IF NOT EXISTS serve_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER REFERENCES calls_for_service(id),
  sm_job_id INTEGER,                       -- ServeManager external job ID (poller PR)
  officer_id INTEGER REFERENCES users(id),
  serve_date TEXT,
  recipient_name TEXT,
  recipient_person_id INTEGER REFERENCES persons(id),
  recipient_address TEXT,
  recipient_city TEXT,
  recipient_state TEXT,
  recipient_zip TEXT,
  recipient_lat REAL,
  recipient_lng REAL,
  property_id INTEGER REFERENCES properties(id),
  document_type TEXT,                      -- 'summons' | 'subpoena' | 'eviction' | etc
  case_number TEXT,
  court_name TEXT,
  jurisdiction TEXT,
  client_name TEXT,
  attorney_name TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN (
    'routine','normal','rush','urgent'
  )),
  time_window TEXT,                        -- preferred service window, free-text
  deadline TEXT,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  service_instructions TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending','assigned','in_progress','served','attempted','failed','cancelled'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_serve_queue_status ON serve_queue(status);
CREATE INDEX IF NOT EXISTS idx_serve_queue_officer ON serve_queue(officer_id);
CREATE INDEX IF NOT EXISTS idx_serve_queue_deadline ON serve_queue(deadline);
CREATE INDEX IF NOT EXISTS idx_serve_queue_call ON serve_queue(call_id);

-- ── serve_attempts — append-only attempt log ──
-- Every dispatch to the address generates one row. result captures
-- the outcome (served / no_answer / refused / bad_address / etc).
CREATE TABLE IF NOT EXISTS serve_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER NOT NULL REFERENCES serve_queue(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  attempt_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  officer_id INTEGER REFERENCES users(id),
  result TEXT CHECK(result IN (
    'served','sub_served','posted','no_answer','refused',
    'bad_address','moved','deceased','other'
  )),
  latitude REAL,
  longitude REAL,
  notes TEXT,
  attempt_type TEXT,                       -- 'personal' | 'substitute' | 'posting' | 'mail'
  photo_ids TEXT DEFAULT '[]',             -- JSON array of attachment IDs
  signature_data TEXT,                     -- base64 PNG (small) or attachment ID
  planned_at TEXT,
  window TEXT,
  status TEXT DEFAULT 'attempted' CHECK(status IN (
    'planned','attempted','served','failed'
  )),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_serve_attempts_queue ON serve_attempts(serve_queue_id);
CREATE INDEX IF NOT EXISTS idx_serve_attempts_officer ON serve_attempts(officer_id);

-- ── serve_routes — daily route plan per officer ──
CREATE TABLE IF NOT EXISTS serve_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL REFERENCES users(id),
  route_date TEXT,
  optimized_order_json TEXT DEFAULT '[]',  -- JSON array of serve_queue IDs in service order
  waypoints_json TEXT DEFAULT '[]',
  total_distance_miles REAL,
  total_time_minutes REAL,
  start_lat REAL,
  start_lng REAL,
  end_lat REAL,
  end_lng REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_serve_routes_officer ON serve_routes(officer_id);
CREATE INDEX IF NOT EXISTS idx_serve_routes_date ON serve_routes(route_date);

-- ── serve_skip_traces — address-search audit ──
CREATE TABLE IF NOT EXISTS serve_skip_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER NOT NULL REFERENCES serve_queue(id) ON DELETE CASCADE,
  searched_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  search_type TEXT,                        -- 'tlo' | 'spokeo' | 'lexis' | 'manual'
  search_query TEXT,
  results_json TEXT,
  addresses_found_json TEXT DEFAULT '[]',
  searched_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_serve_skip_traces_queue ON serve_skip_traces(serve_queue_id);
