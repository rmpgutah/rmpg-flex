-- 0089 — dashcam_videos storage-column parity (LOCAL parity only).
--
-- Live D1 (785de7ae) already has all of these columns (verified 2026-06-10
-- via sqlite_master); migration 0052's CREATE was written against a stale
-- shape and fresh local DBs lack the storage columns the upload/stream
-- handlers in src/routes/fleet.ts now use. D1 has no ADD COLUMN IF NOT
-- EXISTS, so on live each ALTER fails with "duplicate column" and the
-- deploy step's continue-on-error skips it — that is expected.
ALTER TABLE dashcam_videos ADD COLUMN camera_id INTEGER;
ALTER TABLE dashcam_videos ADD COLUMN file_path TEXT;
ALTER TABLE dashcam_videos ADD COLUMN mime_type TEXT DEFAULT 'video/mp4';
ALTER TABLE dashcam_videos ADD COLUMN uploaded_by TEXT;
ALTER TABLE dashcam_videos ADD COLUMN updated_at TEXT;
