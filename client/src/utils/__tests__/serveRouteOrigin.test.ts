import { describe, it, expect } from 'vitest';
import {
  resolveRouteOrigin, describeOrigin, describeOriginProblem,
  ORIGIN_MAX_AGE_MINUTES,
} from '../serveRouteOrigin';

const LIVE = { lat: 40.6945, lng: -111.8819, accuracyM: 35 };
const STORED = { found: true, lat: 40.76, lng: -111.89, accuracy_m: 12, age_minutes: 20 };

describe('resolveRouteOrigin', () => {
  it('uses the live fix when the planner IS the officer being planned for', () => {
    const r = resolveRouteOrigin({ planningForSelf: true, liveGps: LIVE, lastKnown: null });
    expect(r.origin).toMatchObject({ lat: LIVE.lat, lng: LIVE.lng, source: 'live_gps', ageMinutes: 0 });
    expect(r.problem).toBeNull();
  });

  it('NEVER uses the live fix when planning for another officer', () => {
    // This is the whole point: the browser's GPS is the SUPERVISOR's position.
    // Anchoring someone else's route there is wrong and was previously silent.
    const r = resolveRouteOrigin({ planningForSelf: false, liveGps: LIVE, lastKnown: null });
    expect(r.origin).toBeNull();
    expect(r.problem).toBe('no_fix');
  });

  it("falls back to the other officer's own last known fix", () => {
    const r = resolveRouteOrigin({ planningForSelf: false, liveGps: LIVE, lastKnown: STORED });
    expect(r.origin).toMatchObject({ lat: STORED.lat, lng: STORED.lng, source: 'last_known', ageMinutes: 20 });
    expect(r.problem).toBeNull();
  });

  it('prefers a live self fix over a stored one', () => {
    const r = resolveRouteOrigin({ planningForSelf: true, liveGps: LIVE, lastKnown: STORED });
    expect(r.origin?.source).toBe('live_gps');
  });

  it('uses a stored fix for self when live GPS is unavailable', () => {
    const r = resolveRouteOrigin({ planningForSelf: true, liveGps: null, lastKnown: STORED });
    expect(r.origin?.source).toBe('last_known');
  });

  it('rejects a fix older than the freshness window and reports HOW stale', () => {
    const stale = { ...STORED, age_minutes: ORIGIN_MAX_AGE_MINUTES + 1 };
    const r = resolveRouteOrigin({ planningForSelf: true, liveGps: null, lastKnown: stale });
    expect(r.origin).toBeNull();
    expect(r.problem).toBe('stale_fix');
    expect(r.rejectedAgeMinutes).toBe(ORIGIN_MAX_AGE_MINUTES + 1);
  });

  it('accepts a fix exactly at the boundary', () => {
    const r = resolveRouteOrigin({
      planningForSelf: true, liveGps: null,
      lastKnown: { ...STORED, age_minutes: ORIGIN_MAX_AGE_MINUTES },
    });
    expect(r.origin?.source).toBe('last_known');
  });

  it('treats an unknown-age fix as unusable rather than assuming it is fresh', () => {
    // An unparseable recorded_at yields age_minutes: null. Anchoring on it is
    // the same failure as anchoring on a stale fix, just harder to notice.
    const r = resolveRouteOrigin({
      planningForSelf: true, liveGps: null,
      lastKnown: { found: true, lat: 40.7, lng: -111.9, age_minutes: null },
    });
    expect(r.origin).toBeNull();
    expect(r.problem).toBe('stale_fix');
  });

  it('reports no_fix when the officer has no stored position', () => {
    const r = resolveRouteOrigin({ planningForSelf: true, liveGps: null, lastKnown: { found: false } });
    expect(r.problem).toBe('no_fix');
  });

  it('does not trust found:true with missing coordinates', () => {
    const r = resolveRouteOrigin({
      planningForSelf: false, liveGps: null,
      lastKnown: { found: true, age_minutes: 5 },
    });
    expect(r.origin).toBeNull();
    expect(r.problem).toBe('no_fix');
  });

  it('honours an explicit freshness window', () => {
    const r = resolveRouteOrigin({
      planningForSelf: true, liveGps: null,
      lastKnown: { ...STORED, age_minutes: 30 }, maxAgeMinutes: 10,
    });
    expect(r.problem).toBe('stale_fix');
  });
});

describe('describeOrigin', () => {
  it('labels a live fix with its accuracy', () => {
    expect(describeOrigin({ lat: 0, lng: 0, source: 'live_gps', accuracyM: 35, ageMinutes: 0 }))
      .toBe('live GPS ±35m');
  });

  it('labels a sub-hour stored fix in minutes', () => {
    expect(describeOrigin({ lat: 0, lng: 0, source: 'last_known', accuracyM: null, ageMinutes: 42 }))
      .toBe('last fix 42m ago');
  });

  it('labels an hours-old fix in hours and minutes', () => {
    expect(describeOrigin({ lat: 0, lng: 0, source: 'last_known', accuracyM: null, ageMinutes: 95 }))
      .toBe('last fix 1h 35m ago');
  });

  it('omits the minute part on a whole-hour fix', () => {
    expect(describeOrigin({ lat: 0, lng: 0, source: 'last_known', accuracyM: null, ageMinutes: 120 }))
      .toBe('last fix 2h ago');
  });

  it('omits accuracy when not reported', () => {
    expect(describeOrigin({ lat: 0, lng: 0, source: 'live_gps', accuracyM: null }))
      .toBe('live GPS');
  });
});

describe('describeOriginProblem', () => {
  it('says how old the rejected fix was', () => {
    const msg = describeOriginProblem({ origin: null, problem: 'stale_fix', rejectedAgeMinutes: 200 });
    expect(msg).toContain('3h ago');
  });

  it('always states the accuracy consequence, so an unanchored route is never silent', () => {
    for (const problem of ['stale_fix', 'no_fix'] as const) {
      expect(describeOriginProblem({ origin: null, problem, rejectedAgeMinutes: null }))
        .toContain('exclude the drive to the first stop');
    }
  });
});
