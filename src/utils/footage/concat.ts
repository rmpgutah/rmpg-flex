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
