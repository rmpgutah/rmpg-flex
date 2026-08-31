import { describe, it, expect } from 'vitest';
import {
  buildServeRunProblem,
  buildPatrolBeatProblem,
  buildDispatchProblem,
  type ServeStop,
  type UnitRow,
  type BeatRow,
  type CallRow,
  resolveOptimizationV2Token,
} from '../src/utils/mapboxOptimizationV2';

const SHIFT_START = '2026-08-17T08:00:00Z';
const SHIFT_END   = '2026-08-17T17:00:00Z';

const officer: UnitRow = { id: 1, call_sign: 'A1', latitude: 40.76, longitude: -111.89 };

const stops: ServeStop[] = [
  { id: 10, recipient_address: '100 Main', recipient_lat: 40.77, recipient_lng: -111.88 },
  { id: 11, recipient_address: '200 Oak',  recipient_lat: 40.78, recipient_lng: -111.87,
    time_window: '09:00-11:00', priority: '1' },
  { id: 12, recipient_address: '300 Elm',  recipient_lat: 40.79, recipient_lng: -111.86,
    deadline: '2026-08-17T16:00:00Z', priority: '2' },
];

describe('buildServeRunProblem', () => {
  it('produces a valid V2 document shape', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    expect(doc.version).toBe(1);
    expect(Array.isArray(doc.locations)).toBe(true);
    expect(Array.isArray(doc.vehicles)).toBe(true);
    expect(Array.isArray(doc.services)).toBe(true);
  });

  it('includes depot + one location per stop', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    expect(doc.locations).toHaveLength(stops.length + 1); // depot + stops
  });

  it('has exactly one vehicle matching the officer call sign', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    expect(doc.vehicles).toHaveLength(1);
    expect(doc.vehicles[0].name).toBe('A1');
    expect(doc.vehicles[0].routing_profile).toBe('mapbox/driving-traffic');
    expect(doc.vehicles[0].earliest_start).toBe(SHIFT_START);
    expect(doc.vehicles[0].latest_end).toBe(SHIFT_END);
  });

  it('sets service_times from time_window when present', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    const svc11 = doc.services.find((s) => s.name === '11');
    expect(svc11?.service_times).toBeDefined();
    expect(svc11?.service_times![0].type).toBe('strict');
    expect(svc11?.service_times![0].earliest).toContain('09:00');
    expect(svc11?.service_times![0].latest).toContain('11:00');
  });

  it('sets service_times from deadline when no time_window', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    const svc12 = doc.services.find((s) => s.name === '12');
    expect(svc12?.service_times![0].latest).toBe('2026-08-17T16:00:00Z');
    expect(svc12?.service_times![0].type).toBe('soft_end');
  });

  it('no service_times when neither time_window nor deadline', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    const svc10 = doc.services.find((s) => s.name === '10');
    expect(svc10?.service_times).toBeUndefined();
  });

  it('uses 18 min residential / 22 min business onsite duration', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    expect(doc.services.find((s) => s.name === '10')?.duration).toBe(18 * 60);
    const biz: ServeStop = {
      id: 30, recipient_address: '1 Commerce', recipient_lat: 40.77, recipient_lng: -111.88,
      recipient_type: 'business',
    };
    const bizDoc = buildServeRunProblem([biz], officer, SHIFT_START, SHIFT_END);
    expect(bizDoc.services[0].duration).toBe(22 * 60);
  });

  it('uses min-schedule-completion-time objective', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    expect(doc.options?.objectives).toContain('min-schedule-completion-time');
  });

  it('maps named serve windows onto Denver wall-clock service_times', () => {
    const morning: ServeStop = {
      id: 20, recipient_address: '1 St', recipient_lat: 40.77, recipient_lng: -111.88,
      time_window: 'morning',
    };
    // Shift starts at 14:00 UTC = 08:00 Denver (MDT) — morning window (06-12) is valid
    const doc = buildServeRunProblem([morning], officer, '2026-08-28T14:00:00.000Z', '2026-08-28T23:00:00.000Z');
    const tw = doc.services[0].service_times![0];
    expect(tw.type).toBe('strict');
    expect(tw.earliest).toBe('2026-08-28T06:00:00-06:00');
    expect(tw.latest).toBe('2026-08-28T12:00:00-06:00');
  });

  it('omits a morning window when the shift starts after noon', () => {
    const morning: ServeStop = {
      id: 22, recipient_address: '1 St', recipient_lat: 40.77, recipient_lng: -111.88,
      time_window: 'morning',
    };
    // Shift starts at 00:15 UTC Aug 29 = 6:15 PM Denver — well after morning window
    const doc = buildServeRunProblem([morning], officer, '2026-08-29T00:15:00.000Z', '2026-08-29T08:00:00.000Z');
    expect(doc.services[0].service_times).toBeUndefined();
  });

  it('omits anytime windows', () => {
    const anytime: ServeStop = {
      id: 21, recipient_address: '1 St', recipient_lat: 40.77, recipient_lng: -111.88,
      time_window: 'anytime',
    };
    const doc = buildServeRunProblem([anytime], officer, SHIFT_START, SHIFT_END);
    expect(doc.services[0].service_times).toBeUndefined();
  });

  it('locks a circular vehicle to the depot and leaves open-path end unset', () => {
    const round = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END, { circular: true });
    expect(round.vehicles[0].end_location).toBe(`officer-${officer.id}-depot`);
    const open = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END, { circular: false });
    expect(open.vehicles[0].end_location).toBeUndefined();
  });

  it('schedules an unpaid lunch break 12:00–13:00 Denver', () => {
    const doc = buildServeRunProblem(stops, officer, '2026-08-28T14:00:00.000Z', SHIFT_END);
    const brk = doc.vehicles[0].breaks?.[0];
    expect(brk?.duration).toBe(1800);
    expect(brk?.earliest_start).toBeDefined();
    expect(brk?.latest_end).toBeDefined();
    const startHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver', hour: 'numeric', hourCycle: 'h23',
    }).format(new Date(brk!.earliest_start)));
    expect(startHour).toBe(12);
  });
});

describe('resolveOptimizationV2Token', () => {
  it('prefers MAPBOX_SECRET_TOKEN including sk. worker tokens', () => {
    expect(resolveOptimizationV2Token({
      MAPBOX_SECRET_TOKEN: 'sk.live-v2',
      MAPBOX_ACCESS_TOKEN: 'pk.public',
    })).toBe('sk.live-v2');
  });

  it('falls back to MAPBOX_ACCESS_TOKEN', () => {
    expect(resolveOptimizationV2Token({
      MAPBOX_ACCESS_TOKEN: 'pk.public',
    })).toBe('pk.public');
  });

  it('returns null when neither token is set', () => {
    expect(resolveOptimizationV2Token({})).toBeNull();
    expect(resolveOptimizationV2Token({ MAPBOX_SECRET_TOKEN: '  ', MAPBOX_ACCESS_TOKEN: '' })).toBeNull();
  });
});

const beats: BeatRow[] = [
  { id: 1, beat_code: 'B1', min_lat: 40.7, max_lat: 40.8, min_lng: -111.9, max_lng: -111.8 },
  { id: 2, beat_code: 'B2', min_lat: 40.8, max_lat: 40.9, min_lng: -111.9, max_lng: -111.8 },
];
const units: UnitRow[] = [
  { id: 1, call_sign: 'A1', latitude: 40.75, longitude: -111.85 },
  { id: 2, call_sign: 'A2', latitude: 40.76, longitude: -111.86 },
];

describe('buildPatrolBeatProblem', () => {
  it('produces a valid V2 document', () => {
    const doc = buildPatrolBeatProblem(beats, units, SHIFT_START, SHIFT_END);
    expect(doc.version).toBe(1);
  });

  it('vehicle count matches unit count', () => {
    const doc = buildPatrolBeatProblem(beats, units, SHIFT_START, SHIFT_END);
    expect(doc.vehicles).toHaveLength(units.length);
  });

  it('location count = units + beats', () => {
    const doc = buildPatrolBeatProblem(beats, units, SHIFT_START, SHIFT_END);
    expect(doc.locations).toHaveLength(units.length + beats.length);
  });

  it('service count matches beat count', () => {
    const doc = buildPatrolBeatProblem(beats, units, SHIFT_START, SHIFT_END);
    expect(doc.services).toHaveLength(beats.length);
  });

  it('uses min-total-travel-duration objective', () => {
    const doc = buildPatrolBeatProblem(beats, units, SHIFT_START, SHIFT_END);
    expect(doc.options?.objectives).toContain('min-total-travel-duration');
  });

  it('routing profile is mapbox/driving (not traffic)', () => {
    const doc = buildPatrolBeatProblem(beats, units, SHIFT_START, SHIFT_END);
    expect(doc.vehicles[0].routing_profile).toBe('mapbox/driving');
  });
});

const calls: CallRow[] = [
  { id: 100, latitude: 40.77, longitude: -111.87, priority: '1' },
  { id: 101, latitude: 40.78, longitude: -111.88, priority: '3' },
];

describe('buildDispatchProblem', () => {
  it('produces a valid V2 document', () => {
    const doc = buildDispatchProblem(calls, units);
    expect(doc.version).toBe(1);
  });

  it('vehicle count matches unit count', () => {
    const doc = buildDispatchProblem(calls, units);
    expect(doc.vehicles).toHaveLength(units.length);
  });

  it('service count matches call count', () => {
    const doc = buildDispatchProblem(calls, units);
    expect(doc.services).toHaveLength(calls.length);
  });

  it('priority 1 call → 1800s duration', () => {
    const doc = buildDispatchProblem(calls, units);
    expect(doc.services.find((s) => s.name === 'call-100')?.duration).toBe(1800);
  });

  it('priority 3 call → 600s duration', () => {
    const doc = buildDispatchProblem(calls, units);
    expect(doc.services.find((s) => s.name === 'call-101')?.duration).toBe(600);
  });

  it('uses mapbox/driving-traffic profile', () => {
    const doc = buildDispatchProblem(calls, units);
    expect(doc.vehicles[0].routing_profile).toBe('mapbox/driving-traffic');
  });
});
