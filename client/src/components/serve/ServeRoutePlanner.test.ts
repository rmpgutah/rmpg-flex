import { describe, it, expect } from 'vitest';
import { haversineMiles, estimateDriveMinutes, nearestNeighborOrder } from './ServeRoutePlanner';

function stop(id: number, lat: number, lng: number) {
  return {
    job: { id, recipient_lat: lat, recipient_lng: lng } as any,
    selected: true,
    order: 0,
  };
}

describe('haversineMiles', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMiles(40.76, -111.89, 40.76, -111.89)).toBe(0);
  });

  it('returns a positive distance between two distinct points', () => {
    const d = haversineMiles(40.7608, -111.891, 40.7708, -111.881);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(20); // sanity bound — these points are close
  });
});

describe('estimateDriveMinutes', () => {
  it('returns 0 for zero or negative distance', () => {
    expect(estimateDriveMinutes(0)).toBe(0);
    expect(estimateDriveMinutes(-5)).toBe(0);
  });

  it('scales with distance', () => {
    expect(estimateDriveMinutes(10)).toBeGreaterThan(estimateDriveMinutes(5));
  });
});

describe('nearestNeighborOrder', () => {
  it('greedily picks the closest unvisited stop from the origin', () => {
    // Origin near stop A; B and C are progressively farther in a line.
    const a = stop(1, 40.760, -111.890);
    const b = stop(2, 40.762, -111.888);
    const c = stop(3, 40.770, -111.880);
    // Deliberately out of order so a naive "keep input order" pass would fail.
    const { ordered } = nearestNeighborOrder([c, a, b], { lat: 40.7605, lng: -111.8905 });
    expect(ordered.map(s => s.job.id)).toEqual([1, 2, 3]);
  });

  it('computes a positive total distance across multiple stops', () => {
    const a = stop(1, 40.760, -111.890);
    const b = stop(2, 40.770, -111.880);
    const { totalDistanceMiles, totalDurationMinutes } = nearestNeighborOrder([a, b], { lat: 40.750, lng: -111.900 });
    expect(totalDistanceMiles).toBeGreaterThan(0);
    expect(totalDurationMinutes).toBeGreaterThan(0);
  });

  it('returns zero distance for a single stop with no prior cursor movement needed', () => {
    const a = stop(1, 40.760, -111.890);
    const { ordered, totalDistanceMiles } = nearestNeighborOrder([a], null);
    expect(ordered.map(s => s.job.id)).toEqual([1]);
    expect(totalDistanceMiles).toBe(0);
  });
});
