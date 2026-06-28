-- ClearPath → ALPR pipeline, Phase B: media-sync storage.
-- dashcam_videos exists on live but lacks the cpg_* sync columns; dashcam_events
-- does not exist. D1 has no IF NOT EXISTS on ADD COLUMN, so a re-apply will error
-- on the ALTERs — that's expected (deploy step is continue-on-error) and the
-- clearpathgps route reconciles these columns at boot as a backstop.

ALTER TABLE dashcam_videos ADD COLUMN cpg_device_id TEXT;
ALTER TABLE dashcam_videos ADD COLUMN cpg_camera_id INTEGER;
ALTER TABLE dashcam_videos ADD COLUMN cpg_media_timestamp INTEGER;   -- event epoch ms
ALTER TABLE dashcam_videos ADD COLUMN cpg_channel TEXT;              -- "outside" | "inside"
ALTER TABLE dashcam_videos ADD COLUMN cpg_event_type TEXT;
ALTER TABLE dashcam_videos ADD COLUMN cpg_access_url TEXT;
ALTER TABLE dashcam_videos ADD COLUMN cpg_thumbnail_url TEXT;
ALTER TABLE dashcam_videos ADD COLUMN cpg_gps_track TEXT;            -- JSON array
ALTER TABLE dashcam_videos ADD COLUMN r2_key TEXT;                   -- R2 object key
ALTER TABLE dashcam_videos ADD COLUMN linked_dashcam_event_id INTEGER;
ALTER TABLE dashcam_videos ADD COLUMN alpr_status TEXT;             -- Phase C: pending|done|skipped|failed

CREATE INDEX IF NOT EXISTS idx_dashcam_videos_cpg
  ON dashcam_videos(cpg_device_id, cpg_media_timestamp, cpg_channel);

CREATE TABLE IF NOT EXISTS dashcam_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cpg_device_id TEXT NOT NULL,
  unit_id INTEGER,
  dashcam_id TEXT,
  event_type TEXT NOT NULL,
  event_timestamp TEXT NOT NULL,        -- ISO/SQL datetime (UTC)
  cpg_media_timestamp INTEGER,          -- raw epoch ms (dedup key)
  latitude REAL,
  longitude REAL,
  speed_mph REAL,
  address TEXT,
  status_code TEXT,
  status_code_text TEXT,
  video_available INTEGER DEFAULT 0,
  source TEXT DEFAULT 'clearpathgps',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dashcam_events_device ON dashcam_events(cpg_device_id, cpg_media_timestamp);
CREATE INDEX IF NOT EXISTS idx_dashcam_events_ts ON dashcam_events(event_timestamp);
