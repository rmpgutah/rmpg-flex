import { describe, it, expect } from 'vitest';
import {
  haversineMiles, estimateDriveMinutes, nearestNeighborOrder, isJobPreselected, reorderList,
  describeMissedDeadlines, plannedStartToMs, formatEtaDenver, computeArrivalsFromLegDurations,
  clampArrivalToServeWindow, computeArrivalsInOrder,
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
    const urgent = stop(2, farLat, farLng, new Date(directArrivalMs).toISOString()); // new-date-ok: epoch ms, not a server timestamp string

    const { ordered } = nearestNeighborOrder([near, urgent], origin, start);
    expect(ordered.map(s => s.job.id)).toEqual([2, 1]);
  });

  it('flags a job whose deadline is already unreachable given its position in the route', () => {
    const start = 1_000_000_000_000;
    const origin = { lat: 40.700, lng: -111.900 };
    // A deadline that already passed before the route even started is
    // unreachable no matter what — the simplest possible infeasible case.
    const alreadyLate = stop(1, 40.900, -111.700, new Date(start - 1).toISOString()); // new-date-ok: epoch ms, not a server timestamp string
    const { missedDeadlineJobIds } = nearestNeighborOrder([alreadyLate], origin, start);
    expect(missedDeadlineJobIds).toEqual([1]);
  });

  it('does not put an evening next-attempt stop first when the run starts at 14:30', () => {
    const start = Date.parse('2026-08-28T20:30:00.000Z'); // 14:30 MDT
    const origin = { lat: 40.6945, lng: -111.8817 };
    const evening = stop(1, 40.695, -111.882);
    evening.job.next_attempt_window = '18:00-21:00';
    evening.job.next_attempt_date = '2026-08-28';
    evening.job.time_window = 'anytime';
    const business = stop(2, 40.72, -111.89);
    business.job.recipient_type = 'business';
    business.job.time_window = 'anytime';
    const { ordered, perStopArrivalMs } = nearestNeighborOrder([evening, business], origin, start, '2026-08-28');
    expect(ordered.map(s => s.job.id)).toEqual([2, 1]);
    const eveningEta = perStopArrivalMs[ordered.findIndex(s => s.job.id === 1)];
    expect(eveningEta).toBeGreaterThanOrEqual(Date.parse('2026-08-29T00:00:00.000Z')); // 18:00 MDT
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

describe('plannedStartToMs / formatEtaDenver', () => {
  it('interprets the date picker as America/Denver wall clock, not the browser zone', () => {
    const ms = plannedStartToMs('2026-08-28', '14:30');
    expect(new Date(ms).toISOString()).toBe('2026-08-28T20:30:00.000Z'); // new-date-ok — epoch ms from plannedStartToMs
  });

  it('labels a next-day arrival so 11:45 AM is not mistaken for the same afternoon', () => {
    const nextMorning = Date.parse('2026-08-29T17:45:00.000Z'); // 11:45 AM MDT Aug 29
    expect(formatEtaDenver(nextMorning, '2026-08-28')).toMatch(/11:45\sAM \(\+1d\)/);
  });
});

describe('computeArrivalsFromLegDurations', () => {
  it('walks driving seconds then dwell so the last ETA matches the footer clock', () => {
    const a = stop(1, 40.76, -111.89);
    const b = stop(2, 40.77, -111.88);
    const start = Date.parse('2026-08-28T20:30:00.000Z');
    const { arrivals, totalDurationMinutes } = computeArrivalsFromLegDurations(
      [a, b],
      start,
      [600, 300], // 10 min then 5 min
    );
    expect(arrivals.get(1)).toBe(start + 600_000);
    // 10 min drive + 12 min individual dwell + 5 min drive
    expect(arrivals.get(2)).toBe(start + 600_000 + 12 * 60_000 + 300_000);
    expect(totalDurationMinutes).toBeCloseTo(10 + 12 + 5 + 12, 5);
  });
});

describe('same-day windows at a 6pm start', () => {
  it('does not label a missed morning band as +1d', () => {
    const start = plannedStartToMs('2026-08-28', '18:00');
    const evening = start + 15 * 60_000;
    const clamped = clampArrivalToServeWindow(evening, '08:00', '12:00', '2026-08-28');
    expect(clamped).toBe(evening);
    expect(formatEtaDenver(clamped, '2026-08-28')).not.toMatch(/\+1d/);
  });

  it('keeps a 3-stop evening run on tonight’s clock', () => {
    const start = plannedStartToMs('2026-08-28', '18:00');
    const a = stop(1, 40.6945, -111.8819);
    a.job.time_window = 'evening';
    a.job.next_attempt_window = '18:00-21:00';
    const b = stop(2, 40.70, -111.88);
    b.job.time_window = 'morning';
    b.job.next_attempt_window = '08:00-12:00';
    b.job.next_attempt_date = '2026-08-29';
    const c = stop(3, 40.71, -111.87);
    c.job.time_window = 'morning';
    c.job.next_attempt_window = '08:00-12:00';
    const { arrivals, totalDurationMinutes } = computeArrivalsInOrder(
      [a, b, c],
      { lat: 40.6945, lng: -111.8819 },
      start,
      '2026-08-28',
    );
    expect(formatEtaDenver(arrivals.get(2)!, '2026-08-28')).not.toMatch(/\+1d/);
    expect(formatEtaDenver(arrivals.get(3)!, '2026-08-28')).not.toMatch(/\+1d/);
    expect(totalDurationMinutes).toBeLessThan(90);
    expect(formatEtaDenver(arrivals.get(2)!, '2026-08-28')).toMatch(/PM/);
  });
});
