-- Dial Connect: copy every recording (calls + voicemails) into RMPG Flex R2.
-- Rows arrive with only a recording_source_url on dialer.rmpgutah.us; the Worker
-- mirrors the bytes into encrypted R2 (recording_r2_key) on ingest and via the
-- */30 cron sweep. These columns track bounded retries so a dead upstream URL
-- cannot be re-fetched forever. Both tables are far below the 100-column cap.
-- Idempotency: the route also reconciles these columns at runtime (columnExists).
ALTER TABLE dialer_calls ADD COLUMN recording_mirror_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dialer_calls ADD COLUMN recording_mirror_error TEXT;
ALTER TABLE dialer_calls ADD COLUMN recording_mirrored_at TEXT;
ALTER TABLE dialer_voicemails ADD COLUMN recording_mirror_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dialer_voicemails ADD COLUMN recording_mirror_error TEXT;
ALTER TABLE dialer_voicemails ADD COLUMN recording_mirrored_at TEXT;
