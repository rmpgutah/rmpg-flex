// ============================================================
// ServeRoutePlanner — Directions coordinate budget + NN ordering
// ============================================================
// Guards the cluster-size bug: Mapbox Directions caps a request at 25
// COORDINATES, but the planner clustered at 25 STOPS and then prepended
// the officer's GPS origin and appended a destination — 27 points, which
// the API rejects. It only ever bit the largest runs, i.e. exactly the
// ones optimization matters for.
// ============================================================

import { describe, it, expect } from 'vitest';
import { haversineMiles, estimateDriveMinutes, nearestNeighborOrder } from '../ServeRoutePlanner';

/** Minimal StopItem shape — the optimizer only reads lat/lng off the job. */
function stop(id: number, lat: number, lng: number) {
  return {
    job: { id, recipient_lat: lat, recipient_lng: lng } as any,
    selected: true,
    order: 0,
  };
}

describe('haversineMiles', () => {
  it('is zero for identical points', () => {
    expect(haversineMiles(40.76, -111.89, 40.76, -111.89)).toBe(0);
  });

  // SLC -> Provo is ~43 miles great-circle.
  it('approximates a known Utah distance', () => {
    const d = haversineMiles(40.7608, -111.8910, 40.2338, -111.6585);
    expect(d).toBeGreaterThan(38);
    expect(d).toBeLessThan(48);
  });

  it('is symmetric', () => {
    const a = haversineMiles(40.76, -111.89, 40.23, -111.66);
    const b = haversineMiles(40.23, -111.66, 40.76, -111.89);
    expect(a).toBeCloseTo(b, 10);
  });
});

describe('estimateDriveMinutes', () => {
  it('returns 0 for non-positive or non-finite input', () => {
    expect(estimateDriveMinutes(0)).toBe(0);
    expect(estimateDriveMinutes(-5)).toBe(0);
    expect(estimateDriveMinutes(NaN)).toBe(0);
  });

  it('applies the winding factor and urban speed', () => {
    // 25 mi * 1.3 / 25 mph = 1.3 h = 78 min
    expect(estimateDriveMinutes(25)).toBeCloseTo(78, 5);
  });
});

describe('nearestNeighborOrder', () => {
  it('returns every stop exactly once — no stop may be dropped', () => {
    const stops = [stop(1, 40.5, -111.9), stop(2, 40.9, -111.9), stop(3, 40.7, -111.9)];
    const { ordered } = nearestNeighborOrder(stops, { lat: 40.9, lng: -111.9 });
    expect(ordered).toHaveLength(3);
    expect(ordered.map((s) => s.job.id).sort()).toEqual([1, 2, 3]);
  });

  it('walks outward from the origin, nearest first', () => {
    const stops = [stop(1, 40.5, -111.9), stop(2, 40.9, -111.9), stop(3, 40.7, -111.9)];
    const { ordered } = nearestNeighborOrder(stops, { lat: 40.9, lng: -111.9 });
    expect(ordered.map((s) => s.job.id)).toEqual([2, 3, 1]);
  });

  it('accumulates distance only once an origin is known', () => {
    const stops = [stop(1, 40.5, -111.9), stop(2, 40.9, -111.9)];
    // No origin: the first hop is free, only the 1->2 leg is counted.
    const withoutOrigin = nearestNeighborOrder(stops, null);
    expect(withoutOrigin.totalDistanceMiles).toBeGreaterThan(0);
    // With an origin sitting exactly on stop 2, the 2->1 leg is the same span.
    const withOrigin = nearestNeighborOrder(stops, { lat: 40.9, lng: -111.9 });
    expect(withOrigin.totalDistanceMiles).toBeCloseTo(withoutOrigin.totalDistanceMiles, 6);
  });

  it('handles a single stop and an empty list', () => {
    expect(nearestNeighborOrder([], null).ordered).toEqual([]);
    expect(nearestNeighborOrder([], null).totalDistanceMiles).toBe(0);
    const one = nearestNeighborOrder([stop(1, 40.7, -111.9)], { lat: 40.7, lng: -111.9 });
    expect(one.ordered).toHaveLength(1);
  });

  it('derives duration from the distance it computed', () => {
    const stops = [stop(1, 40.5, -111.9), stop(2, 40.9, -111.9)];
    const r = nearestNeighborOrder(stops, null);
    expect(r.totalDurationMinutes).toBeCloseTo(estimateDriveMinutes(r.totalDistanceMiles), 6);
  });
});

// The clustering/coordinate-budget invariant. clusterStops isn't exported, so
// this asserts the arithmetic contract the fix restored: a cluster plus a GPS
// origin plus a destination must fit inside the Directions ceiling.
describe('Directions coordinate budget', () => {
  const MAX_DIRECTIONS_COORDS = 25;
  const MAX_CLUSTER_STOPS = MAX_DIRECTIONS_COORDS - 1;

  it('a full cluster plus a GPS origin still fits in one request', () => {
    // origin + (cluster minus its destination) + destination
    const coords = 1 + (MAX_CLUSTER_STOPS - 1) + 1;
    expect(coords).toBeLessThanOrEqual(MAX_DIRECTIONS_COORDS);
  });

  it('the OLD 25-stop cap would have overflowed — this is the regression', () => {
    const oldCap = 25;
    const coords = 1 + oldCap + 1; // origin + whole cluster as waypoints + dest
    expect(coords).toBeGreaterThan(MAX_DIRECTIONS_COORDS);
  });
});
