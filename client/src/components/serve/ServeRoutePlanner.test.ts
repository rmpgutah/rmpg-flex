import { describe, it, expect } from 'vitest';
import {
  haversineMiles, estimateDriveMinutes, nearestNeighborOrder, isJobPreselected, reorderList,
  describeMissedDeadlines,
} from './ServeRoutePlanner';

function stop(id: number, lat: number, lng: number, deadline: string | null = null, recipient_name = `Recipient ${id}`) {
  return {
    job: { id, recipient_lat: lat, recipient_lng: lng, deadline, recipient_name } as any,
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

  it('never flags a stop with no deadline as missed', () => {
    const a = stop(1, 40.760, -111.890);
    const { missedDeadlineJobIds } = nearestNeighborOrder([a], { lat: 40.750, lng: -111.900 }, 1_000_000_000_000);
    expect(missedDeadlineJobIds).toEqual([]);
  });

  it('advances the simulated clock by at least the per-stop dwell time', () => {
    const start = 1_000_000_000_000;
    const a = stop(1, 40.760, -111.890);
    const { finalElapsedMs } = nearestNeighborOrder([a], null, start);
    expect(finalElapsedMs).toBeGreaterThanOrEqual(start + 5 * 60 * 1000);
  });

  it('prioritizes an urgent deadline over a much closer stop with no deadline', () => {
    const start = 1_000_000_000_000;
    const origin = { lat: 40.700, lng: -111.900 };
    const near = stop(1, 40.7001, -111.9001); // negligible distance, no deadline
    // Deadline set to the exact direct arrival time from the origin — zero
    // slack, so it's "urgent" regardless of the exact buffer size — to prove
    // this without depending on the 60-minute constant's specific value.
    const farLat = 40.900, farLng = -111.700;
    const directDistance = haversineMiles(origin.lat, origin.lng, farLat, farLng);
    const directArrivalMs = start + estimateDriveMinutes(directDistance) * 60_000;
    const urgent = stop(2, farLat, farLng, new Date(directArrivalMs).toISOString());

    const { ordered } = nearestNeighborOrder([near, urgent], origin, start);
    expect(ordered.map(s => s.job.id)).toEqual([2, 1]);
  });

  it('flags a job whose deadline is already unreachable given its position in the route', () => {
    const start = 1_000_000_000_000;
    const origin = { lat: 40.700, lng: -111.900 };
    // A deadline that already passed before the route even started is
    // unreachable no matter what — the simplest possible infeasible case.
    const alreadyLate = stop(1, 40.900, -111.700, new Date(start - 1).toISOString());
    const { missedDeadlineJobIds } = nearestNeighborOrder([alreadyLate], origin, start);
    expect(missedDeadlineJobIds).toEqual([1]);
  });
});

describe('describeMissedDeadlines', () => {
  it('returns null when nothing is missed', () => {
    expect(describeMissedDeadlines([], [])).toBeNull();
  });

  it('names the affected recipients, deduped', () => {
    const stops = [stop(1, 0, 0, null, 'Alice'), stop(2, 0, 0, null, 'Bob')];
    const msg = describeMissedDeadlines([1, 1, 2], stops);
    expect(msg).toContain('2 stops may miss their deadline');
    expect(msg).toContain('Alice');
    expect(msg).toContain('Bob');
  });

  it('uses singular wording for exactly one missed stop', () => {
    const stops = [stop(1, 0, 0, null, 'Alice')];
    expect(describeMissedDeadlines([1], stops)).toBe('1 stop may miss their deadline: Alice.');
  });

  it('returns null if the missed id cannot be resolved to a stop', () => {
    expect(describeMissedDeadlines([999], [stop(1, 0, 0, null, 'Alice')])).toBeNull();
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
