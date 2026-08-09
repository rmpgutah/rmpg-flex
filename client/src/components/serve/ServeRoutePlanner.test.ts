import { describe, it, expect } from 'vitest';
import { haversineMiles, estimateDriveMinutes, nearestNeighborOrder, isJobPreselected, reorderList } from './ServeRoutePlanner';

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

describe('isJobPreselected', () => {
  it('falls back to the status-based default when no preselection set is given', () => {
    expect(isJobPreselected('pending', undefined, 1)).toBe(true);
    expect(isJobPreselected('in_progress', undefined, 1)).toBe(true);
    expect(isJobPreselected('served', undefined, 1)).toBe(false);
    expect(isJobPreselected('failed', undefined, 1)).toBe(false);
  });

  it('falls back to the status-based default when the preselection set is empty', () => {
    expect(isJobPreselected('pending', new Set(), 1)).toBe(true);
    expect(isJobPreselected('served', new Set(), 1)).toBe(false);
  });

  it('when a non-empty preselection set is given, membership overrides the status default entirely', () => {
    const preselected = new Set([2, 3]);
    // Job 1 would default to selected by status, but is NOT in the set.
    expect(isJobPreselected('pending', preselected, 1)).toBe(false);
    // Job 2 is in the set.
    expect(isJobPreselected('pending', preselected, 2)).toBe(true);
    // Job 3 would default to UNselected by status (served), but IS in the set —
    // the officer explicitly staged it, so membership wins.
    expect(isJobPreselected('served', preselected, 3)).toBe(true);
  });
});

describe('reorderList', () => {
  it('moves an item forward, shifting the items in between back by one', () => {
    expect(reorderList(['a', 'b', 'c', 'd', 'e'], 0, 3)).toEqual(['b', 'c', 'd', 'a', 'e']);
  });

  it('moves an item backward, shifting the items in between forward by one', () => {
    expect(reorderList(['a', 'b', 'c', 'd', 'e'], 4, 1)).toEqual(['a', 'e', 'b', 'c', 'd']);
  });

  it('is a no-op when fromIdx equals toIdx', () => {
    const list = ['a', 'b', 'c'];
    expect(reorderList(list, 1, 1)).toBe(list);
  });

  it('is a no-op for an out-of-range index instead of throwing or corrupting the list', () => {
    const list = ['a', 'b', 'c'];
    expect(reorderList(list, -1, 1)).toBe(list);
    expect(reorderList(list, 1, 5)).toBe(list);
  });

  it('does not mutate the input array', () => {
    const list = ['a', 'b', 'c'];
    const result = reorderList(list, 0, 2);
    expect(list).toEqual(['a', 'b', 'c']);
    expect(result).not.toBe(list);
  });
});
