-- Dial Connect transcription backstop.
--
-- Every mirrored call/voicemail recording must end up with a transcript. The
-- PRIMARY transcription path is upstream in dispatch-app (Twilio Voice
-- Intelligence, else the OpenAI pipeline) and forwards its text here via the
-- `transcript_ready` event. Both of those silently no-op when their
-- credentials are unset, which is how recordings ended up archived with
-- transcript_status = 'none' forever and nothing on screen saying so.
--
-- These columns let the Worker's own Whisper sweep (src/utils/dialerTranscription.ts)
-- bound its retries per row and surface why a row was skipped, exactly as
-- migration 0280 did for the recording mirror.
ALTER TABLE dialer_calls ADD COLUMN transcript_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dialer_calls ADD COLUMN transcript_error TEXT;
ALTER TABLE dialer_calls ADD COLUMN transcript_source TEXT;

ALTER TABLE dialer_voicemails ADD COLUMN transcript_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dialer_voicemails ADD COLUMN transcript_error TEXT;
ALTER TABLE dialer_voicemails ADD COLUMN transcript_source TEXT;

-- Partial index over exactly the sweep's candidate set: a mirrored recording
-- with no transcript yet. Keeps the */30 sweep off a full table scan as the
-- archive grows.
CREATE INDEX IF NOT EXISTS idx_dialer_calls_transcript_pending
  ON dialer_calls(id) WHERE recording_r2_key IS NOT NULL AND transcript IS NULL;
CREATE INDEX IF NOT EXISTS idx_dialer_vm_transcript_pending
  ON dialer_voicemails(id) WHERE recording_r2_key IS NOT NULL AND transcript IS NULL;
