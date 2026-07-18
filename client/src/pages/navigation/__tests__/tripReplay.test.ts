import { describe, it, expect } from 'vitest';
import { replayIndexAt, replayDurationMs, type ReplayPoint } from '../tripReplay';

const points: ReplayPoint[] = [
  { lat: 40.76, lng: -111.89, time: '2026-07-08T10:00:00Z', speed: 0, heading: 0 },
  { lat: 40.761, lng: -111.891, time: '2026-07-08T10:00:10Z', speed: 20, heading: 90 },
  { lat: 40.762, lng: -111.892, time: '2026-07-08T10:00:20Z', speed: 25, heading: 90 },
];

describe('replayIndexAt', () => {
  it('returns index 0 at elapsed 0', () => {
    expect(replayIndexAt(points, 0, 1)).toBe(0);
  });
  it('advances to the matching point at real-time speed', () => {
    expect(replayIndexAt(points, 10000, 1)).toBe(1);
  });
  it('advances faster under a speed multiplier', () => {
    expect(replayIndexAt(points, 5000, 2)).toBe(1);
  });
  it('clamps at the last point past the end', () => {
    expect(replayIndexAt(points, 999999, 1)).toBe(2);
  });
  it('returns 0 for an empty point list', () => {
    expect(replayIndexAt([], 5000, 1)).toBe(0);
  });
});

describe('replayDurationMs', () => {
  it('computes total elapsed time across the points', () => {
    expect(replayDurationMs(points)).toBe(20000);
  });
  it('returns 0 for fewer than 2 points', () => {
    expect(replayDurationMs([points[0]])).toBe(0);
  });
});
