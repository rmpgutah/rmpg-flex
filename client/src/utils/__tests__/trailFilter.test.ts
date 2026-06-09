import { describe, it, expect } from 'vitest';
import { trimByAge, decimate } from '../trailFilter';

describe('trailFilter — trimByAge', () => {
  const now = 100_000_000;
  it('drops points older than the window', () => {
    const pts = [
      { lat: 1, lng: 1, t: now - 20 * 60_000 }, // 20 min old
      { lat: 2, lng: 2, t: now - 5 * 60_000 },  // 5 min old
      { lat: 3, lng: 3, t: now },                // fresh
    ];
    const kept = trimByAge(pts, 10, now); // 10-minute window
    expect(kept.length).toBe(2);
    expect(kept[0].lat).toBe(2);
  });
  it('keeps timestamp-less points', () => {
    const pts = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2, t: now - 9_999_999 }];
    expect(trimByAge(pts, 1, now).length).toBe(1 + 0); // old one dropped, untimed kept
  });
  it('non-positive window returns a copy of all', () => {
    const pts = [{ lat: 1, lng: 1, t: 0 }];
    expect(trimByAge(pts, 0, now)).toEqual(pts);
  });
});

describe('trailFilter — decimate', () => {
  it('returns input untouched when under cap', () => {
    const pts = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }];
    expect(decimate(pts, 10)).toEqual(pts);
  });

  it('caps vertex count and preserves endpoints', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ lat: i * 0.001, lng: i * 0.001 }));
    const out = decimate(pts, 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('preserves high-deviation corner of an L-shape', () => {
    // straight east, then sharp turn north — the corner must survive.
    const pts = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 2 }, // corner
      { lat: 1, lng: 2 },
      { lat: 2, lng: 2 },
    ];
    const out = decimate(pts, 3);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out).toContainEqual({ lat: 0, lng: 2 }); // the corner
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[4]);
  });
});
