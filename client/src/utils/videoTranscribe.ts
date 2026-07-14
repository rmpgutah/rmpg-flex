// client/src/utils/videoTranscribe.ts
// Client-side audio-track extraction for a just-uploaded body-cam video.
// No ffmpeg.wasm (this codebase already abandoned it — see the comment in
// renderRedacted.ts explaining why it can't load in a module worker) — this
// uses captureStream() + an audio-only MediaRecorder instead, the same
// browser-native technique the redaction renderer relies on. Non-blocking:
// callers must treat a rejection/null as "skip transcription".
const EXTRACT_TIMEOUT_MS = 60000; // generous — playback runs at real-time speed

/**
 * Load `file` into a hidden <video>, play it muted while recording ONLY its
 * audio track via MediaRecorder, and resolve the recorded blob (or null on
 * any failure/timeout/silent-clip). Always revokes the object URL it creates.
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
    const cleanup = () => { URL.revokeObjectURL(url); clearTimeout(timeoutId); video.pause(); };
    const finish = (result: Blob | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const timeoutId = setTimeout(() => finish(null), EXTRACT_TIMEOUT_MS);

    video.onloadedmetadata = async () => {
      try {
        const stream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
        const audioTracks = stream?.getAudioTracks() ?? [];
        if (!stream || audioTracks.length === 0) { finish(null); return; }

        const audioOnlyStream = new MediaStream(audioTracks);
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(audioOnlyStream, { mimeType: 'audio/webm;codecs=opus' });
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
