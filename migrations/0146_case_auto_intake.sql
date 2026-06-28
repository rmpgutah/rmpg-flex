-- ============================================================
-- 0146_case_auto_intake.sql
-- ============================================================
-- Auto-create a Case File for every Serve Intake batch so that all
-- downstream artifacts (CFS dispatches, attempts, records, photos,
-- intake docs) attach to a single anchor record.
--
-- Adds:
--   1. serve_queue.case_id — denormalized FK pointer so every read
--      path that already touches serve_queue can resolve "the case
--      for this job" in one column read, without joining through
--      calls_for_service.case_id (which is null for address-less
--      intake batches that never produced a CFS).
--   2. case_serve_jobs — junction so a case can also be queried in
--      the case_calls/case_persons/etc. style: SELECT * FROM
--      case_serve_jobs WHERE case_id = ?. Cases.ts /full handler
--      can read this exactly like the existing junctions.
--   3. serve_intake_documents.case_id — denormalized link so every
--      uploaded packet (PDFs, photos, OCR'd field sheets) routes
--      into the case's document drawer. We don't bridge through
--      `documents` + document_links because serve_intake_documents
--      has its own table shape (R2 keys + per-file OCR metadata)
--      that doesn't fit the `documents` body/revisions model.
--
-- D1 does NOT support `IF NOT EXISTS` on `ADD COLUMN`. Re-applying
-- this against a database that already has these columns raises
-- "duplicate column name", which the deploy step swallows
-- (continue-on-error per CLAUDE.md). After merging, ALSO apply
-- this DDL directly to live D1 785de7ae and verify with:
--   pragma_table_info('serve_queue')              -- expect case_id col
--   pragma_table_info('serve_intake_documents')   -- expect case_id col
--   SELECT name FROM sqlite_master WHERE type='table' AND name='case_serve_jobs'
-- ============================================================

ALTER TABLE serve_queue ADD COLUMN case_id INTEGER;
ALTER TABLE serve_intake_documents ADD COLUMN case_id INTEGER;

CREATE TABLE IF NOT EXISTS case_serve_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  serve_queue_id INTEGER NOT NULL,
  added_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  UNIQUE(case_id, serve_queue_id)
);
CREATE INDEX IF NOT EXISTS idx_case_serve_jobs_case ON case_serve_jobs(case_id);
CREATE INDEX IF NOT EXISTS idx_case_serve_jobs_queue ON case_serve_jobs(serve_queue_id);

-- Fast lookup the other direction: given a queue row, find its case.
CREATE INDEX IF NOT EXISTS idx_serve_queue_case_id ON serve_queue(case_id);
CREATE INDEX IF NOT EXISTS idx_serve_intake_docs_case ON serve_intake_documents(case_id);
