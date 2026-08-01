import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { relTime, isPermanentError, PERMANENT_ERROR_PREFIX } from '../AdminFleetioHealthTab';

// Pin Date.now so the relative-time math is deterministic.
const FROZEN = new Date('2026-06-21T18:00:00Z').getTime();
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(FROZEN); });
afterAll(() => { vi.useRealTimers(); });

describe('relTime', () => {
  it('returns "—" for null / undefined / empty', () => {
    expect(relTime(null)).toBe('—');
    expect(relTime(undefined)).toBe('—');
    expect(relTime('')).toBe('—');
  });

  it('returns "—" for non-parseable strings', () => {
    expect(relTime('not a date')).toBe('—');
  });

  it('rounds to "just now" for sub-minute deltas', () => {
    expect(relTime('2026-06-21 17:59:30')).toBe('just now');   // 30s ago (SQLite-style)
    expect(relTime('2026-06-21T17:59:55Z')).toBe('just now');  // 5s ago (ISO)
  });

  it('formats minutes / hours / days correctly', () => {
    expect(relTime('2026-06-21 17:55:00')).toBe('5m');
    expect(relTime('2026-06-21 15:00:00')).toBe('3h');
    expect(relTime('2026-06-19 18:00:00')).toBe('2d');
  });

  it('treats SQLite "YYYY-MM-DD HH:MM:SS" as UTC (no timezone drift)', () => {
    // datetime('now') returns this exact format; the helper must Z-suffix
    // it so the parse doesn't apply local-tz offset.
    expect(relTime('2026-06-21 16:00:00')).toBe('2h');
  });

  it('clamps future timestamps to "just now" (rather than negative numbers)', () => {
    expect(relTime('2026-06-21T19:00:00Z')).toBe('just now');
  });
});

describe('isPermanentError', () => {
  // The Worker stamps this prefix in src/utils/fleetio/sync.ts. The two
  // codebases share no build, so this literal is the contract — if it drifts,
  // the Retry button reappears on events that can only ever 409.
  it('pins the prefix the Worker writes', () => {
    expect(PERMANENT_ERROR_PREFIX).toBe('PERMANENT: ');
  });

  it('detects a permanent failure and its Fleet.io reason', () => {
    expect(isPermanentError('PERMANENT: Fleet.io 422: {"errors":["Meter value too low"]}')).toBe(true);
  });

  it('treats transient failures and empty values as retryable', () => {
    expect(isPermanentError('Fleet.io 503: upstream down')).toBe(false);
    expect(isPermanentError('')).toBe(false);
    expect(isPermanentError(null)).toBe(false);
    expect(isPermanentError(undefined)).toBe(false);
  });
});
