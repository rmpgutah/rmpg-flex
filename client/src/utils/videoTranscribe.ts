// client/src/utils/videoTranscribe.ts
// Client-side audio-track extraction for a just-uploaded body-cam video.
// No ffmpeg.wasm (this codebase already abandoned it — see the comment in
// renderRedacted.ts explaining why it can't load in a module worker) — this
// uses captureStream() + an audio-only MediaRecorder instead, the same
// browser-native technique the redaction renderer relies on. Non-blocking:
// callers must treat a rejection/null as "skip transcription".
// Extraction PLAYS the clip in real time (captureStream() + MediaRecorder), so
// the timeout must scale with the clip's actual duration rather than a flat
// constant — otherwise any clip longer than the constant gets cut off mid-capture
// with zero user-visible signal. These bound the computed timeout:
const EXTRACT_TIMEOUT_DEFAULT_MS = 60000; // fallback when duration is unknown/NaN/Infinity
const EXTRACT_TIMEOUT_MIN_MS = 30000; // floor, for very short clips
const EXTRACT_TIMEOUT_MARGIN_MS = 15000; // decode/model overhead on top of real-time playback
const EXTRACT_TIMEOUT_MAX_MS = 30 * 60 * 1000; // cap so a corrupt/huge duration can't hang forever

// Safari has no MediaRecorder support for audio/webm;codecs=opus as of this writing.
const AUDIO_MIME_TYPE = 'audio/webm;codecs=opus';

/**
 * Load `file` into a hidden <video>, play it muted while recording ONLY its
 * audio track via MediaRecorder, and resolve the recorded blob (or null on
 * any failure/timeout/silent-clip/unsupported-codec). Always revokes the
 * object URL it creates.
 */
export async function extractAudioBlob(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true; // mutes OUTPUT only — captureStream() still taps the decoded track
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => finish(null), EXTRACT_TIMEOUT_DEFAULT_MS);
    const cleanup = () => { URL.revokeObjectURL(url); clearTimeout(timeoutId); video.pause(); };
    function finish(result: Blob | null) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    video.onloadedmetadata = async () => {
      // Now that real duration is known, replace the placeholder timeout with
      // one scaled to actual clip length (extraction runs at real-time speed).
      clearTimeout(timeoutId);
      const duration = video.duration;
      const scaledMs = Number.isFinite(duration) && duration > 0
        ? Math.min(EXTRACT_TIMEOUT_MAX_MS, Math.max(EXTRACT_TIMEOUT_MIN_MS, duration * 1000 + EXTRACT_TIMEOUT_MARGIN_MS))
        : EXTRACT_TIMEOUT_DEFAULT_MS;
      timeoutId = setTimeout(() => finish(null), scaledMs);

      try {
        // Explicit, checked guard instead of relying on the MediaRecorder
        // constructor throwing (which the outer catch would silently swallow
        // into a null result with no diagnostic trail — e.g. on Safari).
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported(AUDIO_MIME_TYPE)) {
          finish(null);
          return;
        }

        const stream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
        const audioTracks = stream?.getAudioTracks() ?? [];
        if (!stream || audioTracks.length === 0) { finish(null); return; }

        const audioOnlyStream = new MediaStream(audioTracks);
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(audioOnlyStream, { mimeType: AUDIO_MIME_TYPE });
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => finish(chunks.length ? new Blob(chunks, { type: 'audio/webm' }) : null);
        recorder.onerror = () => finish(null);

        video.onended = () => { if (recorder.state !== 'inactive') recorder.stop(); };
        recorder.start();
        await video.play();
      } catch {
        finish(null);
      }
    };
    video.onerror = () => finish(null);
  });
}
