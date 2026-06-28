import { describe, it, expect } from 'vitest';
import { markerOffsetMs } from '../src/utils/footage/markerOffset';

const chunks = [ // each 40s; seq 1 is a gap (missing → not on the playable timeline)
  { seq: 0, from_ts: 1000, to_ts: 41000, status: 'downloaded' },
  { seq: 1, from_ts: 41000, to_ts: 81000, status: 'missing' },
  { seq: 2, from_ts: 81000, to_ts: 121000, status: 'downloaded' },
];

describe('markerOffsetMs', () => {
  it('offsets within the first downloaded chunk', () => {
    expect(markerOffsetMs(11000, chunks)).toBe(10000); // 10s into chunk 0
  });
  it('skips the gap so chunk 2 starts at 40000 on the playable timeline', () => {
    expect(markerOffsetMs(91000, chunks)).toBe(50000); // 40000 (chunk0) + 10000 into chunk2
  });
  it('returns null for a ts inside a missing chunk', () => {
    expect(markerOffsetMs(61000, chunks)).toBeNull();
  });
  it('returns null for a ts outside the track', () => {
    expect(markerOffsetMs(500, chunks)).toBeNull();
  });
});
