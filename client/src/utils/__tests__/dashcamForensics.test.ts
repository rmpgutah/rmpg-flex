import { describe, it, expect } from 'vitest';
import {
  haversineMeters, bearingDeg, compass, trackStats, normalizeTrack, positionAtTime, speedColor, forensicVerdict,
  type GpsPoint,
} from '../dashcamForensics';

const pt = (lat: number, lng: number, speed: number, tSec: number, alt = 1300): GpsPoint =>
  ({ latitude: lat, longitude: lng, speed, altitude: alt, timestamp: 1_000_000_000_000 + tSec * 1000 });

// ~straight eastward track, accelerating then braking
const track: GpsPoint[] = [
  pt(40.6997, -111.8830, 10, 0),
  pt(40.6997, -111.8828, 20, 1),
  pt(40.6997, -111.8826, 35, 2),
  pt(40.6997, -111.8824, 30, 3),
  pt(40.6997, -111.8822, 12, 4),
];

describe('dashcamForensics — geo', () => {
  it('haversineMeters is ~0 for identical points and positive otherwise', () => {
    expect(haversineMeters(track[0], track[0])).toBeCloseTo(0, 5);
    expect(haversineMeters(track[0], track[1])).toBeGreaterThan(5);
  });
  it('bearingDeg eastward ≈ 90°, compass maps it to E', () => {
    const b = bearingDeg(track[0], track[1]);
    expect(b).toBeGreaterThan(80); expect(b).toBeLessThan(100);
    expect(compass(b)).toBe('E');
    expect(compass(0)).toBe('N'); expect(compass(180)).toBe('S');
  });
});

describe('dashcamForensics — trackStats', () => {
  it('summarizes speed, distance and g-forces', () => {
    const s = trackStats(track);
    expect(s.points).toBe(5);
    expect(s.durationSec).toBe(4);
    expect(s.maxSpeed).toBe(35);
    expect(s.startSpeed).toBe(10);
    expect(s.endSpeed).toBe(12);
    expect(s.avgSpeed).toBeCloseTo((10 + 20 + 35 + 30 + 12) / 5);
    expect(s.distanceMeters).toBeGreaterThan(0);
    expect(s.maxAccelG).toBeGreaterThan(0);   // 10→20→35 mph accel
    expect(s.maxBrakeG).toBeGreaterThan(0);   // 35→12 mph braking
  });
  it('is safe on empty + single-point tracks', () => {
    expect(trackStats([]).points).toBe(0);
    expect(trackStats([track[0]]).maxSpeed).toBe(10);
  });
});

describe('dashcamForensics — normalizeTrack', () => {
  it('projects points inside the padded box, north-up', () => {
    const pts = normalizeTrack(track, 100, 100, 6);
    expect(pts).toHaveLength(5);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(6 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(94 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(6 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(94 + 1e-6);
    }
    // eastward track → x increases
    expect(pts[4].x).toBeGreaterThan(pts[0].x);
  });
  it('returns [] for an empty track', () => {
    expect(normalizeTrack([])).toEqual([]);
  });
});

describe('dashcamForensics — positionAtTime', () => {
  it('clamps before/after and interpolates mid-track', () => {
    expect(positionAtTime(track, -5)!.index).toBe(0);
    expect(positionAtTime(track, 99)!.index).toBe(4);
    const mid = positionAtTime(track, 1.5)!;
    expect(mid.speed).toBeCloseTo(27.5);   // halfway 20→35
    expect(mid.index).toBe(1);
  });
  it('returns null for empty track', () => {
    expect(positionAtTime([], 0)).toBeNull();
  });
});

describe('dashcamForensics — presentation', () => {
  it('speedColor ramps green→red with speed', () => {
    expect(speedColor(0, 35)).toMatch(/^rgb\(/);
    expect(speedColor(35, 35)).toMatch(/^rgb\(/);
    expect(speedColor(0, 0)).toMatch(/^rgb\(/);   // no divide-by-zero
  });
  it('forensicVerdict tailors to the event type', () => {
    const s = trackStats(track);
    expect(forensicVerdict('Automatic, Frontal Collision Warning', s).toLowerCase()).toContain('collision');
    expect(forensicVerdict('Automatic, Lane Departure', s).toLowerCase()).toContain('lane');
    expect(forensicVerdict('Automatic, Close Following', s).toLowerCase()).toContain('following');
  });
});
