import { describe, it, expect } from 'vitest';
import { isNavGuidanceActive, speedComparison, SPEED_FIX_MAX_AGE_MS } from '../dispatchNavGate';

describe('isNavGuidanceActive', () => {
  it('is active while enroute', () => {
    expect(isNavGuidanceActive('enroute')).toBe(true);
  });
  it('ends on scene', () => {
    expect(isNavGuidanceActive('onscene')).toBe(false);
  });
  it('is inactive before the unit is enroute', () => {
    expect(isNavGuidanceActive('pending')).toBe(false);
    expect(isNavGuidanceActive('dispatched')).toBe(false);
  });
  it('is inactive after the call closes', () => {
    expect(isNavGuidanceActive('cleared')).toBe(false);
    expect(isNavGuidanceActive('closed')).toBe(false);
  });
  it('is inactive for null/undefined', () => {
    expect(isNavGuidanceActive(null)).toBe(false);
    expect(isNavGuidanceActive(undefined)).toBe(false);
  });
});

describe('speedComparison', () => {
  const now = 1_700_000_000_000;
  const fresh = new Date(now - 5_000).toISOString();

  it('converts m/s to mph and pairs it with the limit', () => {
    // 25 m/s = 55.9 mph
    expect(speedComparison({
      gpsSpeedMps: 25, gpsUpdatedAt: fresh, postedLimitMph: 35, nowMs: now,
    })).toEqual({ speedMph: 56, limitMph: 35 });
  });

  it('returns null without a posted limit', () => {
    expect(speedComparison({
      gpsSpeedMps: 25, gpsUpdatedAt: fresh, postedLimitMph: null, nowMs: now,
    })).toBeNull();
  });

  it('returns null without a speed reading', () => {
    expect(speedComparison({
      gpsSpeedMps: null, gpsUpdatedAt: fresh, postedLimitMph: 35, nowMs: now,
    })).toBeNull();
  });

  it('suppresses the comparison when the fix is stale', () => {
    // A stale speed against a fresh limit reads as a confident fact and is not
    // one -- the unit may have stopped, or turned onto a different road.
    const stale = new Date(now - SPEED_FIX_MAX_AGE_MS - 1).toISOString();
    expect(speedComparison({
      gpsSpeedMps: 25, gpsUpdatedAt: stale, postedLimitMph: 35, nowMs: now,
    })).toBeNull();
  });

  it('allows a fix exactly at the age limit', () => {
    const edge = new Date(now - SPEED_FIX_MAX_AGE_MS).toISOString();
    expect(speedComparison({
      gpsSpeedMps: 25, gpsUpdatedAt: edge, postedLimitMph: 35, nowMs: now,
    })).not.toBeNull();
  });

  it('suppresses the comparison when the fix has no timestamp', () => {
    expect(speedComparison({
      gpsSpeedMps: 25, gpsUpdatedAt: undefined, postedLimitMph: 35, nowMs: now,
    })).toBeNull();
  });

  it('suppresses on an unparseable timestamp rather than assuming fresh', () => {
    expect(speedComparison({
      gpsSpeedMps: 25, gpsUpdatedAt: 'not-a-date', postedLimitMph: 35, nowMs: now,
    })).toBeNull();
  });

  it('treats a stationary unit as a real zero, not a missing reading', () => {
    expect(speedComparison({
      gpsSpeedMps: 0, gpsUpdatedAt: fresh, postedLimitMph: 35, nowMs: now,
    })).toEqual({ speedMph: 0, limitMph: 35 });
  });
});
