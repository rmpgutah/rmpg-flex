-- migrations/0119_flexcam_evidence.sql
-- FlexCam Phase 2 evidence governance. ⚠️ apply to live 785de7ae after merge.
-- NOTE: D1 has no IF NOT EXISTS on ADD COLUMN; the runtime reconciler
-- (ensureEvidenceSchema, columnExists-guarded) is the idempotent path. A
-- re-apply of these ALTERs will error on an already-migrated DB — tolerated.
ALTER TABLE footage_requests ADD COLUMN evidence_locked INTEGER DEFAULT 0;
ALTER TABLE footage_requests ADD COLUMN evidence_number TEXT;
ALTER TABLE footage_requests ADD COLUMN classification TEXT DEFAULT 'routine';
ALTER TABLE footage_requests ADD COLUMN preserved_reason TEXT;
ALTER TABLE footage_requests ADD COLUMN preserved_event_type TEXT;
ALTER TABLE footage_requests ADD COLUMN preserved_event_id INTEGER;
ALTER TABLE footage_chunks ADD COLUMN sha256 TEXT;

CREATE TABLE IF NOT EXISTS footage_custody_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  footage_request_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_name TEXT,
  reason TEXT,
  detail TEXT,
  session_key TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_footage_custody_req ON footage_custody_log(footage_request_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_footage_custody_view
  ON footage_custody_log(footage_request_id, actor_user_id, session_key) WHERE action='viewed';

CREATE TABLE IF NOT EXISTS footage_evidence_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  footage_request_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  linked_by INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_footage_evlink
  ON footage_evidence_links(footage_request_id, entity_type, entity_id);
