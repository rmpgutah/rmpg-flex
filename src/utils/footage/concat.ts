// src/utils/footage/concat.ts
import { orderedDownloaded, detectGaps } from './splitWindow';

interface ChunkFull { seq: number; from_ts: number; to_ts: number; status: string; r2_key: string | null; bytes: number; }
export interface Manifest {
  requestId: number;
  chunks: Array<{ seq: number; r2_key: string }>;
  gaps: number[];
  spanMs: number;     // from first chunk start to last chunk end
  playableMs: number; // sum of downloaded chunk durations
}

export function buildManifest(requestId: number, rows: ChunkFull[]): Manifest {
  const ordered = orderedDownloaded(rows);
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  const spanMs = sorted.length ? sorted[sorted.length - 1].to_ts - sorted[0].from_ts : 0;
  const playableMs = rows.filter((r) => r.status === 'downloaded').reduce((s, r) => s + (r.to_ts - r.from_ts), 0);
  return { requestId, chunks: ordered, gaps: detectGaps(rows), spanMs, playableMs };
}

/**
 * Produce ONE continuous file in R2 by streaming the ordered chunk bodies into a
 * single object. Container-safe ONLY for MPEG-TS / fragmented-MP4 (per the format
 * probe). For standard MP4, return 'unsupported' — the client renders the single
 * file with ffmpeg.wasm (`-c copy`) and re-uploads. Phase-1 callers pass 'mp4', so
 * the streaming path is dormant until the spike confirms TS/fMP4.
 */
export async function concatToR2(
  env: { UPLOADS: R2Bucket }, mergedKey: string,
  chunks: Array<{ r2_key: string }>, format: 'ts' | 'fmp4' | 'mp4',
): Promise<'ready' | 'unsupported'> {
  if (format === 'mp4' || !chunks.length) return 'unsupported';
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  (async () => {
    try {
      for (const c of chunks) {
        const obj = await env.UPLOADS.get(c.r2_key);
        if (!obj?.body) continue;
        const reader = obj.body.getReader();
        // pump this object's bytes into the combined stream
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
      }
    } finally {
      await writer.close();
    }
  })();
  await env.UPLOADS.put(mergedKey, readable, { httpMetadata: { contentType: format === 'ts' ? 'video/mp2t' : 'video/mp4' } });
  return 'ready';
}

export interface ChunkRow {
  id: number;
  request_id: number;
  seq: number;
  channel: string;
  from_ts: number;
  to_ts: number;
  status: string;
  r2_key: string | null;
  sha256: string | null;
  bytes: number;
}

export interface TripRef { id: number; start_time: number; end_time: number | null }

export interface PlayerClip {
  seq: number;
  fromTs: number;
  toTs: number;
  durationMs: number;
  url: string;
  sha256: string | null;
  bytes: number;
}

export interface PlayerGap {
  startTs: number;
  endTs: number;
  durationMs: number;
}

export interface TripPlayerManifest {
  tripId: number;
  channel: string;
  totalDurationMs: number;
  stillDownloading: number;
  clips: PlayerClip[];
  gaps: PlayerGap[];
}

const GAP_THRESHOLD_MS = 500;

export function buildPlayerManifest(
  trip: TripRef,
  channel: string,
  chunks: ChunkRow[],
): TripPlayerManifest {
  const inChannel = chunks.filter((c) => c.channel === channel);
  const downloaded = inChannel
    .filter((c) => c.status === 'downloaded' && c.r2_key)
    .sort((a, b) => a.from_ts - b.from_ts);

  const clips: PlayerClip[] = downloaded.map((c) => ({
    seq: c.seq,
    fromTs: c.from_ts,
    toTs: c.to_ts,
    durationMs: c.to_ts - c.from_ts,
    url: `/api/flexcam/footage/${c.request_id}/chunk/${c.seq}/stream`,
    sha256: c.sha256,
    bytes: c.bytes,
  }));

  const gaps: PlayerGap[] = [];
  for (let i = 1; i < downloaded.length; i++) {
    const prev = downloaded[i - 1];
    const cur = downloaded[i];
    const delta = cur.from_ts - prev.to_ts;
    if (delta > GAP_THRESHOLD_MS) {
      gaps.push({ startTs: prev.to_ts, endTs: cur.from_ts, durationMs: delta });
    }
  }

  const totalDurationMs = clips.reduce((s, c) => s + c.durationMs, 0);
  const stillDownloading = inChannel.filter((c) => c.status !== 'downloaded').length;

  return { tripId: trip.id, channel, totalDurationMs, stillDownloading, clips, gaps };
}

const CORRUPTION_THRESHOLD_RATIO = 0.10;

export interface RemuxJobResult {
  state: 'ready' | 'failed';
  sha256?: string;
  bytes?: number;
  skipped: number[];
  errorCode?: string;
  errorMessage?: string;
}

export async function remuxMp4ToFmp4(
  env: { UPLOADS: R2Bucket },
  mergedKey: string,
  chunks: Array<{ seq: number; r2_key: string }>,
): Promise<RemuxJobResult> {
  // Lazy-load so `vi.doMock('./mp4box', ...)` in tests can intercept the binding.
  const { remuxMp4SegmentsToFmp4, Mp4BoxError } = await import('./mp4box');

  const segments: Uint8Array[] = [];
  const skipped: number[] = [];

  for (const c of chunks) {
    try {
      const obj = await env.UPLOADS.get(c.r2_key);
      if (!obj) { skipped.push(c.seq); continue; }
      const buf = new Uint8Array(await obj.arrayBuffer());
      segments.push(buf);
    } catch {
      skipped.push(c.seq);
    }
  }

  const skipRatio = chunks.length === 0 ? 1 : skipped.length / chunks.length;
  if (skipRatio >= CORRUPTION_THRESHOLD_RATIO) {
    return {
      state: 'failed',
      skipped,
      errorCode: 'integrity_threshold_exceeded',
      errorMessage: `${skipped.length}/${chunks.length} chunks unreadable (>= ${Math.round(CORRUPTION_THRESHOLD_RATIO * 100)}%)`,
    };
  }

  try {
    const result = await remuxMp4SegmentsToFmp4(segments);
    await env.UPLOADS.put(mergedKey, result.bytes, {
      httpMetadata: { contentType: 'video/mp4' },
    });
    return {
      state: 'ready',
      sha256: result.sha256,
      bytes: result.bytes.byteLength,
      skipped,
    };
  } catch (err) {
    const code = err instanceof Mp4BoxError ? err.code : 'remux_unknown';
    return {
      state: 'failed',
      skipped,
      errorCode: code,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
