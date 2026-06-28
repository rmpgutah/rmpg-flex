import { describe, it, expect } from 'vitest';
import {
  angleDelta, bearingAt, turnRateDegPerSec, predictPath, predictedHeadingIn,
  videoPredictivePath, pickPrimary, plateRegion, clampBox, vehicleTag, type Detection,
} from '../drivingPrediction';
import type { GpsPoint } from '../dashcamForensics';

const pt = (lat: number, lng: number, speed: number, tSec: number): GpsPoint =>
  ({ latitude: lat, longitude: lng, speed, altitude: 1300, timestamp: 1_000_000_000_000 + tSec * 1000 });

// straight east @ ~35mph
const straight: GpsPoint[] = Array.from({ length: 8 }, (_, i) => pt(40.70, -111.8830 + i * 0.0002, 35, i));
// curving right (east → south) — longitude advances then latitude drops
const turning: GpsPoint[] = [
  pt(40.7000, -111.8830, 30, 0), pt(40.7000, -111.8828, 30, 1), pt(40.7000, -111.8826, 30, 2),
  pt(40.6999, -111.8825, 30, 3), pt(40.6997, -111.8824, 30, 4), pt(40.6995, -111.8824, 30, 5),
];

describe('drivingPrediction — angles', () => {
  it('angleDelta is the signed shortest difference', () => {
    expect(angleDelta(10, 350)).toBe(20);
    expect(angleDelta(350, 10)).toBe(-20);
    expect(angleDelta(90, 90)).toBe(0);
  });
  it('bearingAt eastward ≈ 90°', () => {
    const b = bearingAt(straight, 3);
    expect(b).toBeGreaterThan(80); expect(b).toBeLessThan(100);
  });
});

describe('drivingPrediction — turn rate + path', () => {
  it('turnRateDegPerSec ~0 on a straight track, nonzero on a curve', () => {
    expect(Math.abs(turnRateDegPerSec(straight, 3))).toBeLessThan(3);
    expect(Math.abs(turnRateDegPerSec(turning, 2))).toBeGreaterThan(3);
  });
  it('predictPath projects forward points with growing time', () => {
    const path = predictPath(straight, 3, 3, 0.5);
    expect(path.length).toBe(6);
    expect(path[0].tSec).toBeCloseTo(3.5);
    expect(path[path.length - 1].tSec).toBeCloseTo(6);
    // moving east → longitude should increase across the prediction
    expect(path[path.length - 1].longitude).toBeGreaterThan(path[0].longitude);
  });
  it('predictPath is empty for a degenerate track', () => {
    expect(predictPath([pt(40, -111, 0, 0)], 0)).toEqual([]);
  });
  it('predictedHeadingIn stays ~constant when straight', () => {
    const h = predictedHeadingIn(straight, 3, 2);
    expect(Math.abs(angleDelta(h, bearingAt(straight, 3)))).toBeLessThan(5);
  });
});

describe('drivingPrediction — video path projection', () => {
  it('returns receding samples that narrow toward the vanishing point', () => {
    const path = videoPredictivePath(0, 35, 1280, 720);
    expect(path.length).toBeGreaterThan(5);
    expect(path[0].y).toBeCloseTo(720);                       // starts at hood (bottom)
    expect(path[path.length - 1].y).toBeLessThan(path[0].y);  // recedes upward
    expect(path[path.length - 1].halfWidth).toBeLessThan(path[0].halfWidth); // narrows
    // straight → centred
    expect(path[path.length - 1].x).toBeCloseTo(640, 0);
  });
  it('curves right for a positive turn rate', () => {
    const straightP = videoPredictivePath(0, 35, 1280, 720);
    const rightP = videoPredictivePath(20, 35, 1280, 720);
    expect(rightP[rightP.length - 1].x).toBeGreaterThan(straightP[straightP.length - 1].x);
  });
});

describe('drivingPrediction — detection boxes', () => {
  const dets: Detection[] = [
    { bbox: [600, 400, 120, 90], score: 0.9, cls: 'car' },   // central, low, big → primary
    { bbox: [50, 100, 40, 30], score: 0.8, cls: 'car' },     // small, off to the side
  ];
  it('pickPrimary favors the large central low box', () => {
    expect(pickPrimary(dets, 1280, 720)?.bbox[0]).toBe(600);
    expect(pickPrimary([], 1280, 720)).toBeNull();
  });
  it('plateRegion is a lower-centre sub-box', () => {
    const [px, py, pw, ph] = plateRegion([600, 400, 120, 90]);
    expect(px).toBeGreaterThan(600); expect(px).toBeLessThan(720);
    expect(py).toBeGreaterThan(400 + 90 * 0.5);              // lower half
    expect(pw).toBeLessThan(120); expect(ph).toBeLessThan(90);
  });
  it('clampBox keeps boxes inside the frame', () => {
    expect(clampBox([1200, 700, 200, 200], 1280, 720)).toEqual([1200, 700, 80, 20]);
  });
  it('vehicleTag composes year/color/make/model', () => {
    expect(vehicleTag({ year: 2019, color: 'Black', make: 'Honda', model: 'Civic' })).toBe('2019 Black Honda Civic');
    expect(vehicleTag({ make: 'Ford' })).toBe('Ford');
    expect(vehicleTag(null)).toBe('');
  });
});
