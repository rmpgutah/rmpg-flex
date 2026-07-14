// client/src/utils/videoAiAnalyze.ts
// Frame sampling for on-demand AI object-detection analysis, operating on
// an ALREADY-LOADED <video> element (the one open in VideoPlayer) rather
// than a fresh hidden element built from a File — there is no File object
// for a video that's already uploaded, only its stream URL. Saves and
// restores the element's playback position/pause-state so triggering an
// analysis doesn't disrupt what the operator is watching.

export interface SampledFrame {
  timestamp: number;
  blob: Blob;
}

// Client-local duplicate of the server-side AnalysisResult shape
// (src/utils/bodycamAiAnalysis.ts) — this codebase has no precedent for
// client/src importing from the Worker's src/ (confirmed 2026-07-14; see
// CLAUDE.md's "no build, no tsconfig, no package.json" boundary note), so
// the type is duplicated here rather than imported. Keep in sync by hand
// if the server-side shape changes.
export interface AnalysisResult {
  analyzed_at: string;
  frame_count: number;
  weapon: { detected: boolean; max_confidence: number; timestamps: number[] } | null;
  vehicles: { description: string; timestamps: number[] }[];
  scene_types: { type: string; timestamps: number[] }[];
  force_indicators: { timestamps: number[]; max_confidence: number } | null;
  officer_safety_flags: { flag: string; timestamp: number }[];
}

const SAMPLE_INTERVAL_SEC = 8;
const MAX_FRAMES = 20;
const JPEG_QUALITY = 0.7;
const MAX_LONG_EDGE = 960; // matches the OCR path's payload-size discipline

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
 * MAX_FRAMES, calling `onProgress` after each frame. Restores the
 * element's original currentTime/paused state before resolving (success
 * or failure) so the operator's viewing position is undisturbed.
 */
export async function sampleFramesForAnalysis(
  video: HTMLVideoElement,
  onProgress?: (done: number, total: number) => void,
): Promise<SampledFrame[]> {
  const duration = video.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0) return [];

  const originalTime = video.currentTime;
  const wasPaused = video.paused;
  if (!wasPaused) video.pause();

  const timestamps: number[] = [];
  for (let t = 0; t < duration && timestamps.length < MAX_FRAMES; t += SAMPLE_INTERVAL_SEC) timestamps.push(t);

  const frames: SampledFrame[] = [];
  try {
    for (let i = 0; i < timestamps.length; i++) {
      await seekTo(video, timestamps[i]);
      const blob = captureFrame(video);
      if (blob) frames.push({ timestamp: timestamps[i], blob });
      onProgress?.(i + 1, timestamps.length);
    }
  } finally {
    await seekTo(video, originalTime);
    if (!wasPaused) { try { await video.play(); } catch { /* ignore autoplay rejection on restore */ } }
  }
  return frames;
}
