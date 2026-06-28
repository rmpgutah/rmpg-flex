import { describe, it, expect } from 'vitest';
import { aggressionScore, riskLevel, detectAnomalies, proximity } from '../tacticalIntel';
import type { TrackStats } from '../dashcamForensics';
import type { GpsPoint } from '../dashcamForensics';

const stats = (over: Partial<TrackStats> = {}): TrackStats => ({
  points: 21, durationSec: 20, distanceMeters: 1000, distanceMiles: 0.6,
  maxSpeed: 40, minSpeed: 35, avgSpeed: 38, startSpeed: 38, endSpeed: 38,
  maxAccelG: 0.1, maxBrakeG: 0.1, ...over,
});
const pt = (speed: number, tSec: number, lat = 40.7, lng = -111.88): GpsPoint =>
  ({ latitude: lat, longitude: lng, speed, altitude: 1300, timestamp: 1_000_000_000_000 + tSec * 1000 });

describe('tacticalIntel — aggression score', () => {
  it('is low for routine cruising', () => {
    const r = aggressionScore(stats(), 'Automatic, Lane Departure');
    expect(r.level === 'low' || r.level === 'elevated').toBe(true);
    expect(r.score).toBeLessThan(40);
  });
  it('escalates with high speed + hard braking + collision warning', () => {
    const r = aggressionScore(stats({ maxSpeed: 110, minSpeed: 20, maxBrakeG: 0.6, maxAccelG: 0.5 }), 'Automatic, Frontal Collision Warning');
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.level).toBe('severe');
    expect(r.factors.join(' ')).toMatch(/peak|braking|collision/);
  });
  it('riskLevel tiers map correctly', () => {
    expect(riskLevel(10)).toBe('low');
    expect(riskLevel(30)).toBe('elevated');
    expect(riskLevel(60)).toBe('high');
    expect(riskLevel(90)).toBe('severe');
  });
  it('respects a posted limit', () => {
    const a = aggressionScore(stats({ maxSpeed: 45 }), null, 25);   // 20 over
    const b = aggressionScore(stats({ maxSpeed: 45 }), null, 45);   // at limit
    expect(a.score).toBeGreaterThan(b.score);
  });
});

describe('tacticalIntel — anomalies', () => {
  it('detects a sudden stop and a speed surge', () => {
    const track = [pt(40, 0), pt(40, 1), pt(8, 2), pt(8, 3), pt(40, 4)];
    const keys = detectAnomalies(track).map((a) => a.key);
    expect(keys).toContain('stop');
    expect(keys).toContain('spike');
  });
  it('flags swerving from repeated heading reversals', () => {
    // zig-zag east while alternating north/south
    const track = [
      pt(20, 0, 40.700, -111.8830), pt(20, 1, 40.7003, -111.8828), pt(20, 2, 40.700, -111.8826),
      pt(20, 3, 40.7003, -111.8824), pt(20, 4, 40.700, -111.8822), pt(20, 5, 40.7003, -111.8820),
    ];
    expect(detectAnomalies(track).map((a) => a.key)).toContain('swerve');
  });
  it('returns nothing for a calm straight track', () => {
    const track = Array.from({ length: 6 }, (_, i) => pt(35, i, 40.7, -111.8830 + i * 0.0002));
    expect(detectAnomalies(track)).toEqual([]);
  });
});

describe('tacticalIntel — proximity', () => {
  it('alerts when a box fills the frame and is growing', () => {
    const frame = 1280 * 720;
    expect(proximity(0.45 * frame, 0.3 * frame, frame).level).toBe('alert');
    expect(proximity(0.2 * frame, 0.1 * frame, frame).level).toBe('caution');
    expect(proximity(0.02 * frame, 0.02 * frame, frame).level).toBe('none');
  });
  it('marks closing when area grows', () => {
    const frame = 1000;
    expect(proximity(200, 150, frame).closing).toBe(true);
    expect(proximity(150, 200, frame).closing).toBe(false);
  });
});
