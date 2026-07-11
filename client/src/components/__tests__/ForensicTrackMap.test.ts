import { describe, it, expect } from 'vitest';
import { downsample } from '../ForensicTrackMap';

describe('downsample', () => {
  it('returns the input unchanged when at or under the cap', () => {
    const points = [1, 2, 3];
    expect(downsample(points, 100)).toEqual(points);
    expect(downsample(points, 3)).toEqual(points);
  });

  it('reduces to exactly max points, evenly spanning the full range', () => {
    const points = Array.from({ length: 250 }, (_, i) => i);
    const result = downsample(points, 100);
    expect(result).toHaveLength(100);
    // Must include the first and last point of the original trail — a
    // Map Matching request that drops the trip's actual endpoints would
    // silently truncate the visible route instead of spanning it.
    expect(result[0]).toBe(0);
    expect(result[result.length - 1]).toBe(249);
  });

  it('handles a single point', () => {
    expect(downsample([42], 100)).toEqual([42]);
  });
});
