import { describe, it, expect } from 'vitest';
import { assignClipsToChunks } from '../src/utils/footage/assignClips';

// 40-second chunks across a 4-minute trip starting at T=0 (epoch ms).
const T = 1782028800000;
const CHUNK = 40_000;
const SLOP = 120_000;

function chunk(id: number, seq: number, channel = 'outside') {
  return { id, from_ts: T + seq * CHUNK, to_ts: T + (seq + 1) * CHUNK, channel };
}
function clip(eventTimestamp: number, accessUrl: string, channel = 'outside') {
  return { eventTimestamp, accessUrl, channel };
}

describe('assignClipsToChunks', () => {
  it('returns an empty map when either side is empty', () => {
    expect(assignClipsToChunks([], [chunk(1, 0)], { slopMs: SLOP }).size).toBe(0);
    expect(assignClipsToChunks([clip(T, 'u')], [], { slopMs: SLOP }).size).toBe(0);
  });

  it('assigns one clip to the chunk whose window contains its eventTimestamp', () => {
    const chunks = [chunk(1, 0), chunk(2, 1)];
    const clips = [clip(T + 20_000, 'https://a/clip-A.mp4')]; // mid of chunk-0
    const out = assignClipsToChunks(clips, chunks, { slopMs: SLOP });
    expect(out.size).toBe(1);
    expect(out.get(1)).toEqual({ accessUrl: 'https://a/clip-A.mp4' });
    expect(out.get(2)).toBeUndefined();
  });

  it('assigns each clip to its closest chunk midpoint (no dedup starvation)', () => {
    // Three chunks, three clips offset slightly into each window.
    const chunks = [chunk(1, 0), chunk(2, 1), chunk(3, 2)];
    const clips = [
      clip(T + 20_000, 'https://a/c0.mp4'),
      clip(T + 60_000, 'https://a/c1.mp4'),
      clip(T + 100_000, 'https://a/c2.mp4'),
    ];
    const out = assignClipsToChunks(clips, chunks, { slopMs: SLOP });
    expect(out.get(1)?.accessUrl).toBe('https://a/c0.mp4');
    expect(out.get(2)?.accessUrl).toBe('https://a/c1.mp4');
    expect(out.get(3)?.accessUrl).toBe('https://a/c2.mp4');
  });

  it('never assigns the same clip URL to more than one chunk', () => {
    // Two adjacent chunks, ONE clip — only the closer chunk wins.
    const chunks = [chunk(1, 0), chunk(2, 1)];
    const clips = [clip(T + 25_000, 'https://a/lone.mp4')]; // closer to chunk 1
    const out = assignClipsToChunks(clips, chunks, { slopMs: SLOP });
    expect(out.size).toBe(1);
    expect(out.get(1)?.accessUrl).toBe('https://a/lone.mp4');
  });

  it('respects channel boundaries (inside clips never assigned to outside chunks)', () => {
    const chunks = [chunk(1, 0, 'outside')];
    const clips = [clip(T + 20_000, 'https://a/c0.mp4', 'inside')];
    const out = assignClipsToChunks(clips, chunks, { slopMs: SLOP });
    expect(out.size).toBe(0);
  });

  it('treats non-inside channel labels as "outside" (ClearPath returns "rear", "side", etc.)', () => {
    const chunks = [chunk(1, 0, 'outside')];
    const clips = [
      clip(T + 20_000, 'https://a/rear.mp4', 'rear'),
      clip(T + 25_000, 'https://a/forward.mp4', 'forward'),
    ];
    const out = assignClipsToChunks(clips, chunks, { slopMs: SLOP });
    // First non-inside clip wins (greedy by eventTimestamp).
    expect(out.get(1)?.accessUrl).toBe('https://a/rear.mp4');
  });

  it('rejects clips whose eventTimestamp falls outside ANY chunk window + slop', () => {
    const chunks = [chunk(1, 0), chunk(2, 1)];
    // T + 10 minutes is 10 chunks away, far beyond slop.
    const clips = [clip(T + 10 * 60_000, 'https://a/late.mp4')];
    const out = assignClipsToChunks(clips, chunks, { slopMs: SLOP });
    expect(out.size).toBe(0);
  });

  it('accepts clips slightly outside chunk window but within slop', () => {
    const chunks = [chunk(1, 0)]; // [0, 40s]
    // Clip at +160s: 120s past chunk-end; within 120s slop = TRUE (delta from
    // chunk midpoint = 160-20 = 140s; chunkSpan+slop = 40+120 = 160s).
    const clips = [clip(T + 160_000, 'https://a/late-but-ok.mp4')];
    const out = assignClipsToChunks(clips, chunks, { slopMs: SLOP });
    expect(out.size).toBe(1);
  });

  it('forwards optional contentType + thumbnailUrl to the assignment', () => {
    const chunks = [chunk(1, 0)];
    const clips = [{
      eventTimestamp: T + 20_000, accessUrl: 'https://a/c.mp4', channel: 'outside',
      contentType: 'video/mp4', thumbnailUrl: 'https://a/thumb.jpg',
    }];
    const out = assignClipsToChunks(clips, chunks, { slopMs: SLOP });
    expect(out.get(1)).toEqual({
      accessUrl: 'https://a/c.mp4',
      contentType: 'video/mp4',
      thumbnailUrl: 'https://a/thumb.jpg',
    });
  });

  it('greedy-by-timestamp: an early clip claims the closer chunk even if a later clip is closer to it', () => {
    // chunk-0 mid = 20s, chunk-1 mid = 60s.
    // Clip A at 30s (delta 10s from chunk-0, 30s from chunk-1) → chunk-0
    // Clip B at 35s (delta 15s from chunk-0, 25s from chunk-1) → chunk-1 (the only one left)
    const chunks = [chunk(1, 0), chunk(2, 1)];
    const clips = [
      clip(T + 30_000, 'https://a/A.mp4'),
      clip(T + 35_000, 'https://a/B.mp4'),
    ];
    const out = assignClipsToChunks(clips, chunks, { slopMs: SLOP });
    expect(out.get(1)?.accessUrl).toBe('https://a/A.mp4');
    expect(out.get(2)?.accessUrl).toBe('https://a/B.mp4');
  });
});
