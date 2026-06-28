import { describe, it, expect } from 'vitest';
import { angleDelta, detectTurns, type GpsPoint } from '../src/utils/footage/turns';

describe('angleDelta', () => {
  it('returns signed smallest angle, wrap-aware', () => {
    expect(angleDelta(10, 40)).toBe(30);
    expect(angleDelta(40, 10)).toBe(-30);
    expect(angleDelta(350, 10)).toBe(20);   // wrap forward
    expect(angleDelta(10, 350)).toBe(-20);  // wrap back
  });
});

// Build a leg of n points stepping (dLat,dLng) each, ~ts spacing 1s.
function leg(fromLat: number, fromLng: number, dLat: number, dLng: number, n: number, t0: number): GpsPoint[] {
  const pts: GpsPoint[] = [];
  for (let i = 0; i < n; i++) pts.push({ lat: fromLat + dLat * i, lng: fromLng + dLng * i, ts: t0 + i * 1000 });
  return pts;
}

describe('detectTurns', () => {
  it('finds no turns on a straight track', () => {
    const north = leg(40.0, -111.0, 0.0003, 0, 6, 0);
    expect(detectTurns(north)).toEqual([]);
  });
  it('detects a right turn (north → east)', () => {
    const north = leg(40.0, -111.0, 0.0003, 0, 5, 0);
    const last = north[north.length - 1];
    const east = leg(last.lat, last.lng, 0, 0.0004, 5, 5000);
    const turns = detectTurns([...north, ...east]);
    expect(turns.length).toBe(1);
    expect(turns[0].turnDir).toBe('right');
  });
  it('detects a left turn (north → west)', () => {
    const north = leg(40.0, -111.0, 0.0003, 0, 5, 0);
    const last = north[north.length - 1];
    const west = leg(last.lat, last.lng, 0, -0.0004, 5, 5000);
    const turns = detectTurns([...north, ...west]);
    expect(turns.length).toBe(1);
    expect(turns[0].turnDir).toBe('left');
  });
  it('ignores near-stationary jitter (segments below minSegM)', () => {
    const jitter: GpsPoint[] = Array.from({ length: 8 }, (_, i) => ({
      lat: 40.0 + (i % 2) * 0.000002, lng: -111.0 - (i % 2) * 0.000002, ts: i * 1000,
    }));
    expect(detectTurns(jitter)).toEqual([]);
  });
});
