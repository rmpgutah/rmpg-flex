-- migrations/0125_schema_drift_sweep.sql
-- App-wide D1 schema-drift sweep: columns/tables the Worker write paths use
-- that never reached live D1 (migrations 0042/0090/0105/0110/0119/0121 etc.
-- partially applied during the VPS->Cloudflare cutover, and the deploy migration
-- step is continue-on-error). Found by diffing every INSERT/UPDATE column the code
-- emits against the live schema (pragma_table_info ground truth).
--
-- ⚠️ Already applied directly to live 785de7ae. All idempotent / additive.
-- D1 has no IF NOT EXISTS on ADD COLUMN, so re-applying these ALTERs errors on an
-- already-migrated DB — tolerated.

-- DAR approval timestamp (routes/dar.ts writes it; 0110-era column never landed)
ALTER TABLE daily_activity_reports ADD COLUMN approved_at TEXT;

-- FlexCam evidence governance (migration 0119 never reached live)
ALTER TABLE footage_requests ADD COLUMN evidence_locked INTEGER DEFAULT 0;
ALTER TABLE footage_requests ADD COLUMN evidence_number TEXT;
ALTER TABLE footage_requests ADD COLUMN classification TEXT DEFAULT 'routine';
ALTER TABLE footage_requests ADD COLUMN preserved_reason TEXT;
ALTER TABLE footage_requests ADD COLUMN preserved_event_type TEXT;
ALTER TABLE footage_requests ADD COLUMN preserved_event_id INTEGER;
ALTER TABLE footage_chunks ADD COLUMN sha256 TEXT;

-- CFS Action Bus narrative. The base calls_for_service table is at the D1 100-col
-- cap, so the rolling narrative lives on the 1:1 overflow table (the route was
-- writing/reading calls_for_service.narrative, which 500s — fixed in
-- routes/dispatch/calls.ts to use this column).
ALTER TABLE calls_for_service_ext ADD COLUMN narrative TEXT;

-- call_links: the CFS Action Bus entity-link feature wrote to this table but no
-- migration ever defined it (0022_call_links.sql actually creates call_persons/
-- call_vehicles). Links were silently dropped (insert is try/caught).
CREATE TABLE IF NOT EXISTS call_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(call_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_call_links_call ON call_links(call_id);

-- national warrant source chunking progress (migration 0110 never reached live)
CREATE TABLE IF NOT EXISTS national_warrant_source_progress (
  source_key         TEXT PRIMARY KEY,
  cursor             TEXT,
  cycle_started_at   TEXT,
  last_full_cycle_at TEXT,
  rows_this_cycle    INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT DEFAULT (datetime('now'))
);

-- serve assignment nudges (migration 0105 never reached live)
CREATE TABLE IF NOT EXISTS serve_nudges (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id   INTEGER NOT NULL,
  condition        TEXT NOT NULL,
  last_notified_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(serve_queue_id, condition)
);
CREATE TABLE IF NOT EXISTS serve_nudge_settings (
  id                       INTEGER PRIMARY KEY CHECK(id = 1),
  approaching_hours        INTEGER NOT NULL DEFAULT 48,
  diligence_gap_days       INTEGER NOT NULL DEFAULT 3,
  unassigned_window_hours  INTEGER NOT NULL DEFAULT 72,
  renotify_hours           INTEGER NOT NULL DEFAULT 24,
  notify_supervisor_email  INTEGER NOT NULL DEFAULT 1,
  digest_sender_user_id    INTEGER,
  updated_at               TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by               INTEGER
);

-- Utah DOC custody cache (migration 0121 never reached live)
CREATE TABLE IF NOT EXISTS udc_custody (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offender_number INTEGER UNIQUE NOT NULL,
  offender_name TEXT,
  date_of_birth TEXT,
  location TEXT,
  housing_facility TEXT,
  release_date_and_type TEXT,
  case_manager_name TEXT,
  case_manager_email TEXT,
  detail_json TEXT,
  person_id INTEGER,
  source TEXT DEFAULT 'UDC_API',
  last_seen_at TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
