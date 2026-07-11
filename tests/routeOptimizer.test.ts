import { describe, it, expect } from 'vitest';
import {
  haversineMiles, optimizeStops, estimateDriveMinutes,
  type OptimizableStop,
} from '../src/utils/routeOptimizer';

const SLC = { lat: 40.7608, lng: -111.8910 };            // downtown SLC
const SANDY = { lat: 40.5649, lng: -111.8389 };           // ~14 mi south

const stop = (id: string, lat: number, lng: number, priority = 'P3'): OptimizableStop =>
  ({ id, latitude: lat, longitude: lng, priority });

describe('haversineMiles', () => {
  it('measures SLC → Sandy at roughly 14 miles', () => {
    const d = haversineMiles(SLC, SANDY);
    expect(d).toBeGreaterThan(12);
    expect(d).toBeLessThan(16);
  });

  it('is zero for identical points', () => {
    expect(haversineMiles(SLC, SLC)).toBe(0);
  });
});

describe('optimizeStops', () => {
  it('orders stops nearest-first along a line', () => {
    // Stops strung north→south; origin at the north end.
    const stops = [
      stop('far', 40.55, -111.891),
      stop('near', 40.75, -111.891),
      stop('mid', 40.65, -111.891),
    ];
    const { ordered } = optimizeStops(SLC, stops, false);
    expect(ordered.map((s) => s.id)).toEqual(['near', 'mid', 'far']);
  });

  it('pulls a P1 earlier than pure distance would', () => {
    // P1 slightly farther than a P4 — urgency should win.
    const stops = [
      stop('routine', 40.77, -111.891, 'P4'),   // ~0.6 mi
      stop('emergency', 40.79, -111.891, 'P1'), // ~2.0 mi
    ];
    const unweighted = optimizeStops(SLC, stops, false);
    expect(unweighted.ordered[0].id).toBe('routine');
    const weighted = optimizeStops(SLC, stops, true);
    expect(weighted.ordered[0].id).toBe('emergency');
  });

  it('2-opt untangles a crossing route', () => {
    // Square: origin bottom-left. Greedy NN from a seeded bad order must
    // still produce a tour no worse than visiting corners in perimeter order.
    const stops = [
      stop('a', 40.80, -111.95),
      stop('b', 40.80, -111.85),
      stop('c', 40.70, -111.85),
      stop('d', 40.70, -111.95),
    ];
    const { ordered, totalMiles } = optimizeStops({ lat: 40.70, lng: -111.95 }, stops, false);
    // Perimeter tour from origin (=d's corner): d, a, b, c ≈ 7+5+7 legs.
    // Any crossing order would exceed this.
    expect(ordered.length).toBe(4);
    const perimeter =
      haversineMiles({ lat: 40.70, lng: -111.95 }, { lat: 40.70, lng: -111.95 }) +
      haversineMiles({ lat: 40.70, lng: -111.95 }, { lat: 40.80, lng: -111.95 }) +
      haversineMiles({ lat: 40.80, lng: -111.95 }, { lat: 40.80, lng: -111.85 }) +
      haversineMiles({ lat: 40.80, lng: -111.85 }, { lat: 40.70, lng: -111.85 });
    expect(totalMiles).toBeLessThanOrEqual(perimeter + 0.01);
  });

  it('legs sum to totalMiles and preserve stop payloads', () => {
    const stops = [stop('x', 40.70, -111.90), stop('y', 40.65, -111.88)];
    const { ordered, legsMiles, totalMiles } = optimizeStops(SLC, stops, false);
    expect(legsMiles.length).toBe(2);
    const sum = legsMiles.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - totalMiles)).toBeLessThan(0.001);
    expect(ordered.map((s) => s.id).sort()).toEqual(['x', 'y']);
  });

  it('handles empty and single-stop inputs', () => {
    expect(optimizeStops(SLC, [], false)).toEqual({ ordered: [], legsMiles: [], totalMiles: 0 });
    const one = optimizeStops(SLC, [stop('only', 40.75, -111.89)], true);
    expect(one.ordered[0].id).toBe('only');
    expect(one.legsMiles.length).toBe(1);
  });
});

describe('estimateDriveMinutes', () => {
  it('assumes ~28 mph average with per-stop dwell', () => {
    // 14 miles → 30 min drive; 3 stops → +6 min handling.
    expect(estimateDriveMinutes(14, 3)).toBe(36);
    expect(estimateDriveMinutes(0, 0)).toBe(0);
  });
});
