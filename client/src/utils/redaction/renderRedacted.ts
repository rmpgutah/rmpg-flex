// client/src/utils/redaction/renderRedacted.ts
// Produce a redacted clip entirely in-browser, with ZERO external dependencies:
// play the source once in real time, and on every decoded video frame draw it to
// an offscreen canvas, blur the active regions, burn the evidence stamp, and push
// the frame into a MediaRecorder via canvas.captureStream(0) + requestFrame().
//
// Why not ffmpeg.wasm? @ffmpeg/ffmpeg@0.12.x spawns its core worker as a MODULE
// worker (`type:"module"`), but that worker uses importScripts() to load the core
// — illegal in module workers — so ffmpeg.load() always rejected with the bare
// string "failed to import ffmpeg-core.js" and the export died as "Export failed"
// (confirmed live, 2026-06-15). The classWorkerURL workaround can't help because
// 0.12.x hard-codes type:"module" on that branch too. MediaRecorder is native,
// needs no CDN/worker/CSP surface, and records real MP4/H.264 on Chrome (WebM
// fallback elsewhere). Real-time (clip plays once); clips are short (≤~40s).
//
// NOTE: video-only output — muxing the original clip's audio is deferred (MVP),
// same as the prior ffmpeg path.
import { activeRegionsAt, interpBox, denormBox, type RedactionRegion } from './regions';
import { applyRegionEffect } from './blur';

export interface RecorderFormat {
  mimeType: string;
  ext: 'mp4' | 'webm';
}

// Preference order: real MP4/H.264 first (what investigators/courts expect and
// what Chrome — the field browser — records natively), then WebM as a fallback
// for browsers that can't encode H.264 in MediaRecorder (e.g. Firefox).
const RECORDER_CANDIDATES: RecorderFormat[] = [
  { mimeType: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
  { mimeType: 'video/mp4;codecs=avc1', ext: 'mp4' },
  { mimeType: 'video/mp4', ext: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
  { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
  { mimeType: 'video/webm', ext: 'webm' },
];

/** Pick the best supported recorder container/codec, preferring MP4/H.264.
 *  `isSupported` is injectable so the selection logic is unit-testable without a
 *  real MediaRecorder. Returns null if the browser can record none of them. */
export function pickRecorderFormat(
  isSupported: (mimeType: string) => boolean = (m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
): RecorderFormat | null {
  for (const c of RECORDER_CANDIDATES) if (isSupported(c.mimeType)) return c;
  return null;
}

export interface RenderOpts {
  stamp?: string[];
  /** Bits per second for the recorder. Default 8 Mbps — high enough that the
   *  blurred plate/face redactions can't be sharpened back out of the export. */
  bitrate?: number;
  onProgress?: (frac: number, phase: 'frames' | 'encode') => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  blob: Blob;
  mimeType: string;
  ext: 'mp4' | 'webm';
}

// requestVideoFrameCallback isn't in every TS lib.dom yet; narrow it ourselves.
type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
};
type FrameCaptureTrack = MediaStreamTrack & { requestFrame?: () => void };

function drawStamp(ctx: CanvasRenderingContext2D, lines: string[], W: number, H: number): void {
  if (!lines.length) return;
  const fs = Math.max(11, Math.round(H * 0.022));
  const stripH = fs * (lines.length + 0.6) + 10;
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, H - stripH, W, stripH);
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => {
    ctx.font = `${i === 0 ? 'bold ' : ''}${fs}px sans-serif`;
    ctx.fillStyle = i === 0 ? '#d4a017' : '#e5e5e5';
    ctx.fillText(l, 10, H - stripH + 6 + i * fs * 1.18);
  });
}

export async function renderRedacted(
  video: HTMLVideoElement, regions: RedactionRegion[], opts: RenderOpts = {},
): Promise<RenderResult> {
  const W = video.videoWidth, H = video.videoHeight;
  const duration = video.duration || 0;
  if (!W || !H || !duration) throw new Error('Clip not ready (no dimensions/duration).');

  const fmt = pickRecorderFormat();
  if (!fmt) throw new Error('This browser cannot record video (MediaRecorder unsupported).');

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D unavailable.');

  const stream = canvas.captureStream(0); // 0 fps = manual frame mode (requestFrame)
  const track = stream.getVideoTracks()[0] as FrameCaptureTrack;
  if (!track?.requestFrame) throw new Error('Canvas frame capture unavailable in this browser.');

  const recorder = new MediaRecorder(stream, { mimeType: fmt.mimeType, videoBitsPerSecond: opts.bitrate ?? 8_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  // Draw the current video frame + the active blurred regions + stamp, then push
  // exactly one frame to the recorder. Mirrors the on-screen overlay timeline.
  const drawFrame = () => {
    const t = video.currentTime;
    ctx.drawImage(video, 0, 0, W, H);
    for (const r of activeRegionsAt(regions, t)) {
      applyRegionEffect(ctx, denormBox(interpBox(r, t), W, H), r.style, r.strength);
    }
    drawStamp(ctx, opts.stamp ?? [], W, H);
    track.requestFrame!();
  };

  const v = video as VideoWithRvfc;
  const wasMuted = video.muted, wasPaused = video.paused, startT = video.currentTime;
  video.muted = true;           // export silently; we never capture audio
  video.pause();

  // Rewind to the start so the whole clip is captured.
  await new Promise<void>((res) => {
    const done = () => { video.removeEventListener('seeked', done); res(); };
    video.addEventListener('seeked', done);
    video.currentTime = 0;
  });

  return await new Promise<RenderResult>((resolve, reject) => {
    let rafId = 0, settled = false;
    const useRvfc = typeof v.requestVideoFrameCallback === 'function';

    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      video.removeEventListener('ended', onEnded);
      opts.signal?.removeEventListener('abort', onAbort);
      video.muted = wasMuted;
      video.pause();
      try { video.currentTime = startT; } catch { /* */ }
      if (!wasPaused) video.play().catch(() => {});
    };
    const fail = (err: Error) => { if (settled) return; settled = true; cleanup(); try { recorder.stop(); } catch { /* */ } reject(err); };
    const finish = () => {
      if (settled) return; settled = true;
      cleanup();
      recorder.onstop = () => resolve({ blob: new Blob(chunks, { type: fmt.mimeType }), mimeType: fmt.mimeType, ext: fmt.ext });
      if (recorder.state !== 'inactive') recorder.stop();
      else resolve({ blob: new Blob(chunks, { type: fmt.mimeType }), mimeType: fmt.mimeType, ext: fmt.ext });
    };

    const onEnded = () => finish();
    const onAbort = () => fail(new Error('Redaction cancelled.'));
    recorder.onerror = (e: Event) => fail(new Error(`Recorder error: ${(e as { error?: { name?: string } }).error?.name || 'unknown'}`));

    const tick = () => {
      if (settled) return;
      drawFrame();
      opts.onProgress?.(Math.min(1, video.currentTime / duration), 'frames');
      // Belt-and-suspenders: some streams don't fire 'ended' cleanly at EOF.
      if (video.ended || video.currentTime >= duration - 0.05) { finish(); return; }
      if (useRvfc) v.requestVideoFrameCallback!(tick);
      else rafId = requestAnimationFrame(tick);
    };

    opts.signal?.addEventListener('abort', onAbort, { once: true });
    video.addEventListener('ended', onEnded);

    try { recorder.start(); } catch (e) { fail(new Error(`Recorder failed to start: ${(e as Error)?.message || e}`)); return; }
    if (useRvfc) v.requestVideoFrameCallback!(tick);
    else rafId = requestAnimationFrame(tick);
    video.play().catch((e) => fail(new Error(`Playback failed: ${(e as Error)?.message || e}`)));
  });
}
