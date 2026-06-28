-- 0144 — flexcam remux state columns.
-- Adds the bookkeeping fields the FlexCamRemuxDO uses to mark a footage
-- request through the lazy MP4-to-fMP4 remux pipeline. All ADD COLUMN
-- statements are tolerant of re-apply (D1 doesn't support IF NOT EXISTS
-- on ADD COLUMN, so the Worker's ensureRemuxSchema() reconciler in
-- flexcam.ts guards routes at runtime).

ALTER TABLE footage_requests ADD COLUMN remux_state TEXT;
ALTER TABLE footage_requests ADD COLUMN remux_started_at INTEGER;
ALTER TABLE footage_requests ADD COLUMN remux_finished_at INTEGER;
ALTER TABLE footage_requests ADD COLUMN remux_error TEXT;
ALTER TABLE footage_requests ADD COLUMN remux_attempts INTEGER DEFAULT 0;
ALTER TABLE footage_requests ADD COLUMN merged_sha256 TEXT;

-- Backfill — anything that already has a merged file is implicitly ready.
UPDATE footage_requests SET remux_state = 'ready' WHERE merged_status = 'ready';
