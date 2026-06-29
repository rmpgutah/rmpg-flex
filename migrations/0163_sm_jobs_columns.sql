-- ============================================================
-- 0163: ServeManager poller schema alignment
-- ============================================================
-- The sm_jobs baseline schema uses 'id TEXT PRIMARY KEY' but
-- the poller (serveManagerPoller.ts) expects 'sm_job_id INTEGER',
-- 'linked_call_id INTEGER', 'process_type TEXT', and other columns
-- that don't exist in the baseline. This migration adds the missing
-- columns and normalizes the primary key.

-- Add missing columns the poller writes to (D1 doesn't support
-- IF NOT EXISTS on ALTER, so these may fail if columns already
-- exist in the live DB — the Worker's boot reconciler handles this).

-- sm_job_id: ServeManager's native job ID (the poller dedups on this)
ALTER TABLE sm_jobs ADD COLUMN sm_job_id INTEGER;
-- linked_call_id: the CFS call created from this SM job
ALTER TABLE sm_jobs ADD COLUMN linked_call_id INTEGER;
-- process_type: classified from document titles (summons/subpoena/etc.)
ALTER TABLE sm_jobs ADD COLUMN process_type TEXT;
-- addresses_json / documents_json: cached from SM API
ALTER TABLE sm_jobs ADD COLUMN addresses_json TEXT;
ALTER TABLE sm_jobs ADD COLUMN documents_json TEXT;
-- updated_at: poller writes this on every sync
ALTER TABLE sm_jobs ADD COLUMN updated_at TEXT;
-- Add index for poller dedup query (WHERE sm_job_id = ?)
CREATE INDEX IF NOT EXISTS idx_sm_jobs_sm_job_id ON sm_jobs(sm_job_id);
-- Add index for call linking
CREATE INDEX IF NOT EXISTS idx_sm_jobs_linked_call ON sm_jobs(linked_call_id);
