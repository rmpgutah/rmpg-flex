-- Dial Connect call recordings + transcripts ingested into Flex so dispatch
-- can download audio and print a professional RMPG letterhead PDF without
-- relying on Dial Connect cookies or Twilio credentials in this Worker.
--
-- Ingest: POST /api/integrations/dial-connect-recordings (API key, same
-- service_request scope as the CFS push) or POST /api/dial-connect-recordings
-- (JWT, from the CAD iframe postMessage). Audio lands encrypted in R2.

CREATE TABLE IF NOT EXISTS dial_connect_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recording_sid TEXT NOT NULL UNIQUE,
  call_sid TEXT,
  from_number TEXT,
  to_number TEXT,
  direction TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_seconds INTEGER,
  dispatcher_name TEXT,
  transcript TEXT,
  segments_json TEXT,
  audio_r2_key TEXT,
  audio_content_type TEXT,
  audio_bytes INTEGER,
  source TEXT NOT NULL DEFAULT 'dial_connect',
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dial_connect_recordings_started
  ON dial_connect_recordings(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dial_connect_recordings_call_sid
  ON dial_connect_recordings(call_sid);
CREATE INDEX IF NOT EXISTS idx_dial_connect_recordings_ingested
  ON dial_connect_recordings(ingested_at DESC);
