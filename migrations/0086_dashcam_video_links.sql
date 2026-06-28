-- 0086_dashcam_video_links.sql
-- Backs F2 (dashcam video → entity links). The dashcam_videos table already
-- exists on live D1; this link table did not. Created directly on live
-- 785de7ae on 2026-06-09 (same pattern as the HR tables) and recorded here for
-- local-dev + repo parity. Idempotent.
CREATE TABLE IF NOT EXISTS dashcam_video_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,   -- 'call' | 'incident' | 'case' | 'warrant' | 'citation'
  entity_id INTEGER NOT NULL,
  linked_by TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_dcvl_video ON dashcam_video_links(video_id);
CREATE INDEX IF NOT EXISTS idx_dcvl_entity ON dashcam_video_links(entity_type, entity_id);
