// client/src/utils/videoDeepScan.ts
// Frame sampling for Redaction Studio's on-demand "Deep Scan" — operates on
// the ALREADY-LOADED <video> element in RedactionStudio.tsx, same technique
// as videoAiAnalyze.ts (seek + canvas capture, restore playback position
// after). Samples more densely (every 2s) than the AI Findings feature's 8s,
// since redaction needs to catch faces/plates the free client-side pass
// missed, not just a coarse scene summary. Capped at MAX_FRAMES so a long
// clip must be Deep Scanned over a specific time range rather than in one
// unbounded call — callers pass rangeStart/rangeEnd to restrict sampling.

export interface SampledFrame {
  timestamp: number;
  blob: Blob;
}

// Client-local mirror of the server-side DetectorSample shape
// (src/utils/redactionDeepScan.ts) — same client/src/-cannot-import-src/
// boundary rationale documented in videoAiAnalyze.ts.
export type DeepScanKind = 'face' | 'plate';
export type NormBox = [number, number, number, number];
export interface DetectorSample {
  kind: DeepScanKind;
  box: NormBox;
  t: number;
}

const SAMPLE_INTERVAL_SEC = 2;
const MAX_FRAMES = 30;
const JPEG_QUALITY = 0.7;
const MAX_LONG_EDGE = 960;

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = Math.min(t, Math.max(0, (video.duration || t) - 0.01));
  });
}

function captureFrame(video: HTMLVideoElement): Blob | null {
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  let dataUrl: string;
  try { dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY); } catch { return null; }
  const [, base64] = dataUrl.split(',');
  if (!base64) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

/**
 * Sample frames from `video` at SAMPLE_INTERVAL_SEC intervals, up to
 * MAX_FRAMES, starting at `rangeStart` (default: current playhead) and
 * stopping at `rangeEnd` (default: clip duration) — whichever comes first
 * between the range end and the frame cap. Restores the element's original
 * currentTime/paused state before resolving (success or failure).
 */
export async function sampleFramesForDeepScan(
  video: HTMLVideoElement,
  opts: { rangeStart?: number; rangeEnd?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<SampledFrame[]> {
  const duration = video.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0) return [];

  const originalTime = video.currentTime;
  const wasPaused = video.paused;
  if (!wasPaused) video.pause();

  const start = Math.max(0, opts.rangeStart ?? originalTime);
  const end = Math.min(duration, opts.rangeEnd ?? duration);

  const timestamps: number[] = [];
  for (let t = start; t < end && timestamps.length < MAX_FRAMES; t += SAMPLE_INTERVAL_SEC) timestamps.push(t);

  const frames: SampledFrame[] = [];
  try {
    for (let i = 0; i < timestamps.length; i++) {
      await seekTo(video, timestamps[i]);
      const blob = captureFrame(video);
      if (blob) frames.push({ timestamp: timestamps[i], blob });
      opts.onProgress?.(i + 1, timestamps.length);
    }
  } finally {
    await seekTo(video, originalTime);
    if (!wasPaused) { try { await video.play(); } catch { /* ignore autoplay rejection on restore */ } }
  }
  return frames;
}
