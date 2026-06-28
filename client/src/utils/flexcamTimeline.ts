// client/src/utils/flexcamTimeline.ts
// Pure timeline math for the FlexCam seamless footage player: turn the downloaded
// chunks (in seq order, gaps already excluded) into a gap-collapsed playable
// timeline, and map a marker's playable offset back to (chunk seq, seek-within).
// Unit-tested in flexcamTimeline.test.ts.

export interface PlayChunk { seq: number; durationMs: number; }
export interface TimelineSeg { seq: number; startMs: number; durationMs: number; }
export interface Timeline { segments: TimelineSeg[]; totalMs: number; }

/** Accumulate per-chunk start offsets (seq order) into the playable timeline. */
export function buildTimeline(chunks: PlayChunk[]): Timeline {
  const ordered = [...chunks].sort((a, b) => a.seq - b.seq);
  const segments: TimelineSeg[] = [];
  let startMs = 0;
  for (const c of ordered) {
    const durationMs = Math.max(0, c.durationMs);
    segments.push({ seq: c.seq, startMs, durationMs });
    startMs += durationMs;
  }
  return { segments, totalMs: startMs };
}

/** Map a playable offset (ms) to the chunk + within-chunk time to seek to.
 *  Clamps to the timeline; null when the timeline is empty. */
export function offsetToSeek(offsetMs: number, tl: Timeline): { seq: number; withinMs: number } | null {
  if (!tl.segments.length) return null;
  const clamped = Math.max(0, Math.min(offsetMs, tl.totalMs));
  if (clamped >= tl.totalMs) {
    const last = tl.segments[tl.segments.length - 1];
    return { seq: last.seq, withinMs: last.durationMs };
  }
  for (const s of tl.segments) {
    if (clamped < s.startMs + s.durationMs) return { seq: s.seq, withinMs: clamped - s.startMs };
  }
  const last = tl.segments[tl.segments.length - 1];
  return { seq: last.seq, withinMs: last.durationMs };
}
