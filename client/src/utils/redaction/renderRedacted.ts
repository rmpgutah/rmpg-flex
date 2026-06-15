// client/src/utils/redaction/renderRedacted.ts
// Produce a redacted MP4 entirely in-browser: seek each frame, draw it, blur the
// active regions, burn the evidence stamp, then feed the frame PNGs + original
// audio to the SINGLE-THREADED ffmpeg.wasm core (no SharedArrayBuffer / COOP-COEP
// needed). Slow but frame-accurate; clips are short (≤~40s).
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { activeRegionsAt, interpBox, denormBox, type RedactionRegion } from './regions';
import { applyRegionEffect } from './blur';

const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';

export interface RenderOpts {
  fps?: number;
  stamp?: string[];
  onProgress?: (frac: number, phase: 'frames' | 'encode') => void;
  signal?: AbortSignal;
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    const done = () => { video.removeEventListener('seeked', done); res(); };
    video.addEventListener('seeked', done);
    video.currentTime = Math.min(t, (video.duration || t) - 0.001);
  });
}

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
): Promise<Blob> {
  const fps = opts.fps ?? 12;
  const W = video.videoWidth, H = video.videoHeight;
  const duration = video.duration || 0;
  if (!W || !H || !duration) throw new Error('Clip not ready (no dimensions/duration).');

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D unavailable.');

  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  const wasPaused = video.paused; video.pause();
  try {
    const total = Math.max(1, Math.floor(duration * fps));
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new Error('Redaction cancelled.');
      const t = i / fps;
      await seekTo(video, t);
      ctx.drawImage(video, 0, 0, W, H);
      for (const r of activeRegionsAt(regions, t)) {
        applyRegionEffect(ctx, denormBox(interpBox(r, t), W, H), r.style, r.strength);
      }
      drawStamp(ctx, opts.stamp ?? [], W, H);
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b as Blob), 'image/png'));
      await ffmpeg.writeFile(`f${String(i).padStart(5, '0')}.png`, await fetchFile(blob));
      opts.onProgress?.(i / total, 'frames');
    }

    opts.onProgress?.(0, 'encode');
    // NOTE: video-only output — muxing the original clip's audio is deferred (MVP).
    await ffmpeg.exec([
      '-framerate', String(fps), '-i', 'f%05d.png',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', 'out.mp4',
    ]);
    const data = await ffmpeg.readFile('out.mp4');
    opts.onProgress?.(1, 'encode');
    return new Blob([(data as Uint8Array).buffer as ArrayBuffer], { type: 'video/mp4' });
  } finally {
    if (!wasPaused) video.play().catch(() => {});
  }
}
