import { describe, it, expect } from 'vitest';
import { nowDualStamp, toDenverWallClock } from '../src/utils/denverTime';

describe('toDenverWallClock', () => {
  it('formats a summer (MDT) UTC moment as Denver wall-clock', () => {
    // 2026-06-22T20:30:00Z = 14:30 MDT (UTC-6)
    const input = new Date('2026-06-22T20:30:00Z');
    expect(toDenverWallClock(input)).toBe('2026-06-22T14:30:00');
  });

  it('formats a winter (MST) UTC moment as Denver wall-clock', () => {
    // 2026-12-15T20:30:00Z = 13:30 MST (UTC-7)
    const input = new Date('2026-12-15T20:30:00Z');
    expect(toDenverWallClock(input)).toBe('2026-12-15T13:30:00');
  });

  it('formats a moment exactly at the spring-forward DST transition', () => {
    // 2026-03-08T09:00:00Z — Denver springs forward at 02:00 local, so
    // 09:00Z is post-spring-forward = 03:00 MDT (NOT 02:00 MST).
    const input = new Date('2026-03-08T09:00:00Z');
    expect(toDenverWallClock(input)).toBe('2026-03-08T03:00:00');
  });

  it('zero-pads single-digit hours and minutes', () => {
    // 2026-06-22T13:05:09Z = 07:05:09 MDT
    const input = new Date('2026-06-22T13:05:09Z');
    expect(toDenverWallClock(input)).toBe('2026-06-22T07:05:09');
  });
});

describe('nowDualStamp', () => {
  it('returns both UTC ISO and Denver wall-clock for a passed-in date', () => {
    const fixed = new Date('2026-06-22T20:30:00Z');
    const stamp = nowDualStamp(fixed);
    expect(stamp.utc).toBe('2026-06-22T20:30:00.000Z');
    expect(stamp.local).toBe('2026-06-22T14:30:00');
  });

  it('uses the current time when called with no argument', () => {
    const before = Date.now();
    const stamp = nowDualStamp();
    const after = Date.now();
    const parsed = new Date(stamp.utc).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
    // Local always parses to a wall-clock string
    expect(stamp.local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});
