-- 0187_bodycam_video_artifacts.sql — thumbnail/redacted artifact columns for
-- bodycam_videos, and a nullable bodycam sibling FK on video_redactions so one
-- custody table serves both dashcam events and body-cam videos.
-- Idempotent; the routes also reconcile these columns at runtime via
-- columnExists() because deploy migration-apply is continue-on-error.
-- APPLY DIRECTLY TO LIVE D1 785de7ae AFTER MERGE (scripts/apply-migration.sh).

ALTER TABLE bodycam_videos ADD COLUMN thumbnail_path TEXT;
ALTER TABLE bodycam_videos ADD COLUMN redacted_path TEXT;

ALTER TABLE video_redactions ADD COLUMN source_bodycam_video_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_video_redactions_bodycam
  ON video_redactions (source_bodycam_video_id);
