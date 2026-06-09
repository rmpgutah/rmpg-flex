import { describe, it, expect } from 'vitest';
import { haversineMeters, bearingDeg, movePoint } from '../navGeo';

const SLC = { lat: 40.7608, lng: -111.891 };
const DENVER = { lat: 39.7392, lng: -104.9903 };

describe('navGeo — haversineMeters', () => {
  it('SLC → Denver ≈ 595 km', () => {
    const m = haversineMeters(SLC, DENVER);
    expect(m / 1000).toBeGreaterThan(580);
    expect(m / 1000).toBeLessThan(610);
  });
  it('identical points = 0', () => {
    expect(haversineMeters(SLC, SLC)).toBeCloseTo(0, 3);
  });
});

describe('navGeo — bearingDeg', () => {
  it('SLC → Denver is roughly east-southeast (~100-120°)', () => {
    const b = bearingDeg(SLC, DENVER);
    expect(b).toBeGreaterThan(95);
    expect(b).toBeLessThan(125);
  });
  it('due north', () => {
    const b = bearingDeg({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(b).toBeCloseTo(0, 1);
  });
  it('due east', () => {
    const b = bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(b).toBeCloseTo(90, 1);
  });
});

describe('navGeo — movePoint', () => {
  it('moving N then measuring returns the requested distance', () => {
    const dest = movePoint(SLC, 0, 1000); // 1 km north
    expect(haversineMeters(SLC, dest)).toBeCloseTo(1000, 0);
    expect(dest.lat).toBeGreaterThan(SLC.lat); // went north
  });
  it('round-trips: move out and back is near origin', () => {
    const out = movePoint(SLC, 90, 5000);
    const back = movePoint(out, 270, 5000);
    expect(haversineMeters(SLC, back)).toBeLessThan(5);
  });
});
