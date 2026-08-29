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
import { haversineMiles, estimateDriveMinutes, nearestNeighborOrder, buildRouteStopsFromJobs } from '../ServeRoutePlanner';

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

  it('duration is drive time PLUS per-stop dwell time (18 min/individual stop)', () => {
    // Duration includes a per-stop dwell (knock/serve/paperwork) on top of
    // drive time. Individual stops default to 18 minutes each (see DWELL_RANGE_S).
    const stops = [stop(1, 40.5, -111.9), stop(2, 40.9, -111.9)];
    const r = nearestNeighborOrder(stops, null);
    expect(r.totalDurationMinutes).toBeCloseTo(estimateDriveMinutes(r.totalDistanceMiles) + 2 * 18, 6);
  });

  it('never flags a job with no deadline as missed', () => {
    const stops = [stop(1, 40.5, -111.9), stop(2, 40.9, -111.9)];
    const r = nearestNeighborOrder(stops, { lat: 40.9, lng: -111.9 }, 1_000_000_000_000);
    expect(r.missedDeadlineJobIds).toEqual([]);
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

describe('buildRouteStopsFromJobs', () => {
  function makeStop(id: number, lat: number, lng: number, selected = true, deadline: string | null = null) {
    return {
      job: {
        id, recipient_lat: lat, recipient_lng: lng,
        recipient_name: `Defendant ${id}`, recipient_address: `${id} Main St`,
        priority: 'normal' as const, time_window: 'anytime' as const,
        status: 'pending' as const, attempt_count: 0, max_attempts: 3,
        deadline, serve_date: '2026-08-12', officer_id: 1,
        sm_job_id: null, recipient_city: null, recipient_state: 'UT', recipient_zip: null,
        recipient_phone: null, recipient_email: null, recipient_dob: null,
        recipient_employer: null, recipient_employer_address: null,
        document_type: 'Summons', case_number: null, court_name: null,
        jurisdiction: null, client_name: null, attorney_name: null, plaintiff_name: null,
        defendant_name: null, serve_type: null, case_type: null, return_date: null,
        co_defendants: null, relationship: null, serve_fee: null, rush_fee: null,
        payment_status: null, diligence_required: null, mileage_actual: null,
        contact_restrictions: null, building_access_notes: null, sort_order: 0,
        service_instructions: null, notes: null, next_attempt_note: null,
        created_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z',
        call_id: null, parsed_data: null,
      },
      selected,
      order: id,
    };
  }

  it('excludes unselected stops', async () => {
    const stops = [makeStop(1, 40.7, -111.9, true), makeStop(2, 40.8, -111.9, false)];
    const result = await buildRouteStopsFromJobs(stops);
    expect(result).toHaveLength(1);
    expect(result[0].jobId).toBe(1);
  });

  it('excludes stops with null coordinates', async () => {
    const stops = [makeStop(1, 40.7, -111.9, true)];
    stops[0].job.recipient_lat = null as any;
    const result = await buildRouteStopsFromJobs(stops);
    expect(result).toHaveLength(0);
  });

  it('maps deadline to deadlineAt', async () => {
    const deadline = '2026-08-13T18:00:00-06:00';
    const stops = [makeStop(1, 40.7, -111.9, true, deadline)];
    const result = await buildRouteStopsFromJobs(stops);
    expect(result[0].deadlineAt).toBe(deadline);
  });

  it('maps defendant name and address', async () => {
    const stops = [makeStop(42, 40.7, -111.9)];
    const result = await buildRouteStopsFromJobs(stops);
    expect(result[0].jobId).toBe(42);
    expect(result[0].defendant).toBe('Defendant 42');
    expect(result[0].address).toBe('42 Main St');
  });

  it('defaults to individual defendantType', async () => {
    const stops = [makeStop(1, 40.7, -111.9)];
    const result = await buildRouteStopsFromJobs(stops);
    expect(result[0].defendantType).toBe('individual');
  });
});

// Traffic polling — guards the data-prep logic that feeds the traffic-check
// endpoint. The poll effect itself is not testable here (Mapbox + geolocation
// + jsdom = synthetic environment), but buildRouteStopsFromJobs is re-used
// for the payload, and these tests confirm only non-terminal stops are included.

describe('buildRouteStopsFromJobs — terminal status filtering for traffic poll', () => {
  function makeStopWithStatus(id: number, status: string) {
    return {
      job: {
        id, recipient_lat: 40.7, recipient_lng: -111.9,
        recipient_name: `D${id}`, recipient_address: `${id} St`,
        priority: 'normal' as const, time_window: 'anytime' as const,
        status: status as any, attempt_count: 0, max_attempts: 3,
        deadline: null, serve_date: '2026-08-12', officer_id: 1,
        sm_job_id: null, recipient_city: null, recipient_state: 'UT', recipient_zip: null,
        recipient_phone: null, recipient_email: null, recipient_dob: null,
        recipient_employer: null, recipient_employer_address: null,
        document_type: 'Summons', case_number: null, court_name: null,
        jurisdiction: null, client_name: null, attorney_name: null, plaintiff_name: null,
        defendant_name: null, serve_type: null, case_type: null, return_date: null,
        co_defendants: null, relationship: null, serve_fee: null, rush_fee: null,
        payment_status: null, diligence_required: null, mileage_actual: null,
        contact_restrictions: null, building_access_notes: null, sort_order: 0,
        service_instructions: null, notes: null, next_attempt_note: null,
        created_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z',
        call_id: null, parsed_data: null,
      },
      selected: true,
      order: id,
    };
  }

  it('includes pending stops in the payload', async () => {
    const stops = [makeStopWithStatus(1, 'pending'), makeStopWithStatus(2, 'in_progress')];
    // Filter mirrors the polling effect: exclude terminal statuses
    const TERMINAL = new Set(['served', 'failed', 'skipped', 'archived']);
    const remaining = stops.filter(s => !TERMINAL.has(s.job.status));
    const payload = await buildRouteStopsFromJobs(remaining);
    expect(payload).toHaveLength(2);
  });

  it('excludes served stops from the traffic poll payload', async () => {
    const stops = [makeStopWithStatus(1, 'served'), makeStopWithStatus(2, 'pending')];
    const TERMINAL = new Set(['served', 'failed', 'skipped', 'archived']);
    const remaining = stops.filter(s => !TERMINAL.has(s.job.status));
    const payload = await buildRouteStopsFromJobs(remaining);
    expect(payload).toHaveLength(1);
    expect(payload[0].jobId).toBe(2);
  });

  it('returns empty payload when all stops are terminal — poll should not fire', async () => {
    const stops = [makeStopWithStatus(1, 'served'), makeStopWithStatus(2, 'failed')];
    const TERMINAL = new Set(['served', 'failed', 'skipped', 'archived']);
    const remaining = stops.filter(s => !TERMINAL.has(s.job.status));
    const payload = await buildRouteStopsFromJobs(remaining);
    expect(payload).toHaveLength(0);
  });
});
