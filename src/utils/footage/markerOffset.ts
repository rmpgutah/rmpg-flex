// src/utils/footage/markerOffset.ts
// Map an absolute event timestamp to its offset on the PLAYABLE (downloaded-only,
// gap-collapsed) timeline of a request's chunks — so a marker pins to the right
// spot in the seamless ordered-chunk player. Pure. Tested.
export interface OffsetChunk { seq: number; from_ts: number; to_ts: number; status: string; }

export function markerOffsetMs(tsMs: number, chunks: OffsetChunk[]): number | null {
  const ordered = [...chunks].sort((a, b) => a.seq - b.seq);
  let played = 0;
  for (const c of ordered) {
    if (c.status !== 'downloaded') continue;          // gaps don't occupy the playable timeline
    if (tsMs >= c.from_ts && tsMs < c.to_ts) return played + (tsMs - c.from_ts);
    played += c.to_ts - c.from_ts;
  }
  return null;                                         // ts in a gap or outside the track
}
