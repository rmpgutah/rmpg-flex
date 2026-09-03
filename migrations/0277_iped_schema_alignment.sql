-- Migration 0270: Align iped_imports and forensic_hash_results with client expectations
-- The client page (IpedPage.tsx) expects columns that don't exist in the legacy schema.
-- Add them as nullable columns with sensible defaults.

-- iped_imports: add job-queue columns the client UI expects
ALTER TABLE iped_imports ADD COLUMN status TEXT DEFAULT 'completed';
ALTER TABLE iped_imports ADD COLUMN input_path TEXT;
ALTER TABLE iped_imports ADD COLUMN output_path TEXT;
ALTER TABLE iped_imports ADD COLUMN profile TEXT DEFAULT 'forensic';
ALTER TABLE iped_imports ADD COLUMN progress_percent INTEGER;
ALTER TABLE iped_imports ADD COLUMN items_found INTEGER;
ALTER TABLE iped_imports ADD COLUMN items_processed INTEGER;
ALTER TABLE iped_imports ADD COLUMN result_summary TEXT;
ALTER TABLE iped_imports ADD COLUMN error_message TEXT;
ALTER TABLE iped_imports ADD COLUMN started_at TEXT;
ALTER TABLE iped_imports ADD COLUMN completed_at TEXT;
ALTER TABLE iped_imports ADD COLUMN updated_at TEXT DEFAULT (datetime('now','localtime'));

-- Backfill input_path from source_query for existing rows
UPDATE iped_imports SET input_path = source_query WHERE input_path IS NULL;
UPDATE iped_imports SET status = 'completed' WHERE status IS NULL;

-- forensic_hash_results: add columns the client hash-search expects
ALTER TABLE forensic_hash_results ADD COLUMN iped_job_id INTEGER;
ALTER TABLE forensic_hash_results ADD COLUMN evidence_id INTEGER;
ALTER TABLE forensic_hash_results ADD COLUMN md5 TEXT;
ALTER TABLE forensic_hash_results ADD COLUMN sha1 TEXT;
ALTER TABLE forensic_hash_results ADD COLUMN sha256 TEXT;
ALTER TABLE forensic_hash_results ADD COLUMN flagged INTEGER DEFAULT 0;
ALTER TABLE forensic_hash_results ADD COLUMN flag_reason TEXT;

-- Backfill md5 from file_hash for existing rows
UPDATE forensic_hash_results SET md5 = file_hash WHERE md5 IS NULL AND hash_type = 'md5';
UPDATE forensic_hash_results SET sha1 = file_hash WHERE sha1 IS NULL AND hash_type = 'sha1';
UPDATE forensic_hash_results SET sha256 = file_hash WHERE sha256 IS NULL AND hash_type = 'sha256';

-- forensic_hash_entries: add file_name if missing (some versions don't have it)
-- Already exists per schema check, no-op
