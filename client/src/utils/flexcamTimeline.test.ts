import { describe, it, expect } from 'vitest';
import { buildTimeline, offsetToSeek, type PlayChunk } from './flexcamTimeline';

const chunks: PlayChunk[] = [
  { seq: 0, durationMs: 40000 },
  { seq: 2, durationMs: 40000 }, // seq 1 was a gap (not downloaded) — not present
  { seq: 3, durationMs: 20000 }, // short final chunk
];

describe('buildTimeline', () => {
  it('accumulates start offsets in seq order and sums total', () => {
    const tl = buildTimeline(chunks);
    expect(tl.totalMs).toBe(100000);
    expect(tl.segments).toEqual([
      { seq: 0, startMs: 0, durationMs: 40000 },
      { seq: 2, startMs: 40000, durationMs: 40000 },
      { seq: 3, startMs: 80000, durationMs: 20000 },
    ]);
  });
  it('handles empty input', () => {
    expect(buildTimeline([])).toEqual({ segments: [], totalMs: 0 });
  });
});

describe('offsetToSeek', () => {
  const tl = buildTimeline(chunks);
  it('maps an offset into the right chunk + within-chunk time', () => {
    expect(offsetToSeek(50000, tl)).toEqual({ seq: 2, withinMs: 10000 });
    expect(offsetToSeek(0, tl)).toEqual({ seq: 0, withinMs: 0 });
  });
  it('clamps a past-the-end offset to the last chunk', () => {
    expect(offsetToSeek(999999, tl)).toEqual({ seq: 3, withinMs: 20000 });
  });
  it('returns null for an empty timeline', () => {
    expect(offsetToSeek(1000, buildTimeline([]))).toBeNull();
  });
});
