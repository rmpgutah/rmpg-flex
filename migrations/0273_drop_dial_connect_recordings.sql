-- Remove the parallel Dial Connect recordings table from #3977.
-- Call audio and transcripts live on dialer_calls / dialer_voicemails
-- (migrations/0272_dialer_connect.sql / #3964).

DROP INDEX IF EXISTS idx_dial_connect_recordings_ingested;
DROP INDEX IF EXISTS idx_dial_connect_recordings_call_sid;
DROP INDEX IF EXISTS idx_dial_connect_recordings_started;
DROP TABLE IF EXISTS dial_connect_recordings;
