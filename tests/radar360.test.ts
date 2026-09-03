// Tests for Radar 360 geo helpers (pure functions only — no D1, no fetch)
import { describe, it, expect } from 'vitest';

// ── Inline copies of the pure helpers from radar360.ts ─────────────────
// (Tested here without importing the route to avoid Hono/D1 deps in Node)

const EARTH_MILES = 3958.8;
function toRad(deg: number) { return deg * Math.PI / 180; }

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function bbox(lat: number, lng: number, radiusMi: number) {
  const dLat = radiusMi / EARTH_MILES * (180 / Math.PI);
  const dLng = dLat / Math.cos(toRad(lat));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('haversineMiles', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMiles(40.76, -111.89, 40.76, -111.89)).toBe(0);
  });

  it('measures ~1 mile correctly (Temple Square → Capitol)', () => {
    // Temple Square SLC: 40.7707, -111.8910
    // Utah State Capitol: 40.7772, -111.8883
    // real straight-line ~0.48 mi
    const d = haversineMiles(40.7707, -111.8910, 40.7772, -111.8883);
    expect(d).toBeGreaterThan(0.4);
    expect(d).toBeLessThan(0.6);
  });

  it('measures known intercontinental distance within 1%', () => {
    // SLC to NYC: roughly 1982 miles
    const d = haversineMiles(40.76, -111.89, 40.71, -74.00);
    expect(d).toBeGreaterThan(1960);
    expect(d).toBeLessThan(2010);
  });
});

describe('bearingDeg', () => {
  it('returns 0° when target is due North', () => {
    const b = bearingDeg(40.0, -111.0, 40.1, -111.0);
    expect(b).toBeCloseTo(0, 0);
  });

  it('returns ~180° when target is due South', () => {
    const b = bearingDeg(40.1, -111.0, 40.0, -111.0);
    expect(b).toBeCloseTo(180, 0);
  });

  it('returns ~90° when target is due East', () => {
    const b = bearingDeg(40.0, -111.0, 40.0, -110.0);
    // At lat 40, due-east bearing ≈ 90° (small error from Earth curvature)
    expect(b).toBeGreaterThan(85);
    expect(b).toBeLessThan(95);
  });

  it('returns ~270° when target is due West', () => {
    const b = bearingDeg(40.0, -111.0, 40.0, -112.0);
    expect(b).toBeGreaterThan(265);
    expect(b).toBeLessThan(275);
  });

  it('result is always in [0, 360)', () => {
    for (const [lat1, lng1, lat2, lng2] of [
      [40, -111, 41, -110], [41, -110, 40, -111],
      [40, -111, 40.5, -111.5], [0, 0, -1, -1],
    ]) {
      const b = bearingDeg(lat1, lng1, lat2, lng2);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});

describe('bbox', () => {
  it('produces a bounding box that contains the origin', () => {
    const { minLat, maxLat, minLng, maxLng } = bbox(40.76, -111.89, 1);
    expect(minLat).toBeLessThan(40.76);
    expect(maxLat).toBeGreaterThan(40.76);
    expect(minLng).toBeLessThan(-111.89);
    expect(maxLng).toBeGreaterThan(-111.89);
  });

  it('box diagonal half-distance is ≥ radius (over-selects at corners)', () => {
    const radiusMi = 2;
    const { minLat, maxLat, minLng, maxLng } = bbox(40.76, -111.89, radiusMi);
    // Center to NE corner must be ≥ radiusMi (the box covers the full circle)
    const cornerDist = haversineMiles(40.76, -111.89, maxLat, maxLng);
    expect(cornerDist).toBeGreaterThanOrEqual(radiusMi);
  });

  it('scales with radius', () => {
    const small = bbox(40.76, -111.89, 0.5);
    const large = bbox(40.76, -111.89, 5);
    expect(large.maxLat - large.minLat).toBeGreaterThan(small.maxLat - small.minLat);
  });
});
