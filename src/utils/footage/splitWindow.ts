// src/utils/footage/splitWindow.ts
import type { ChunkSpec, ChunkRow } from './types';

/** Split [fromTs,toTs] (epoch ms) into ordered, contiguous chunks of <= maxSeconds. */
export function splitWindow(fromTs: number, toTs: number, maxSeconds: number): ChunkSpec[] {
  const span = toTs - fromTs;
  if (!Number.isFinite(span) || span <= 0 || maxSeconds <= 0) return [];
  const step = maxSeconds * 1000;
  const out: ChunkSpec[] = [];
  for (let i = 0; ; i++) {
    const start = fromTs + i * step;
    if (start >= toTs) break;
    out.push({ seq: i, fromTs: start, toTs: Math.min(start + step, toTs) });
  }
  return out;
}

/** Seqs of chunks that the camera never had (status 'missing'). */
export function detectGaps(rows: ChunkRow[]): number[] {
  return rows.filter((r) => r.status === 'missing').map((r) => r.seq).sort((a, b) => a - b);
}

/** Downloaded chunks (with a key) in seq order — the playable/concatenable set. */
export function orderedDownloaded(rows: ChunkRow[]): Array<{ seq: number; r2_key: string }> {
  return rows
    .filter((r) => r.status === 'downloaded' && !!r.r2_key)
    .sort((a, b) => a.seq - b.seq)
    .map((r) => ({ seq: r.seq, r2_key: r.r2_key as string }));
}
