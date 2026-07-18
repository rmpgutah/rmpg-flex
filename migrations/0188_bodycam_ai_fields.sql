-- 0188_bodycam_ai_fields.sql — video-edit + AI-detection/transcription
-- columns for bodycam_videos. Idempotent; the route also reconciles these
-- columns at runtime via columnExists() because deploy migration-apply is
-- continue-on-error. APPLY DIRECTLY TO LIVE D1 785de7ae AFTER MERGE.

ALTER TABLE bodycam_videos ADD COLUMN interaction_type TEXT;
ALTER TABLE bodycam_videos ADD COLUMN detected_plate_count INTEGER;
ALTER TABLE bodycam_videos ADD COLUMN detected_face_count INTEGER;
ALTER TABLE bodycam_videos ADD COLUMN detection_regions_json TEXT;
ALTER TABLE bodycam_videos ADD COLUMN transcript TEXT;
