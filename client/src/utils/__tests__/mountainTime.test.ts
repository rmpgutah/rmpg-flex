// Mandatory Mountain Time — these lock in that stored UTC timestamps always
// display in America/Denver (DST-aware) and that the datetime-local edit
// round-trip is lossless, regardless of the CI runner's timezone.
import { describe, it, expect } from 'vitest';
import {
  formatDateTime,
  formatShortTime,
  toDatetimeLocalValue,
  mtDatetimeLocalToUtc,
} from '../dateUtils';
import { formatTime } from '../../pages/dispatch/utils/dispatchFormatters';

describe('mandatory Mountain Time display', () => {
  // 2026-05-29 00:59:41 UTC === 2026-05-28 18:59:41 MDT (UTC-6, summer/DST)
  it('renders summer UTC timestamps in MDT (UTC-6)', () => {
    expect(formatDateTime('2026-05-29 00:59:41')).toBe('05/28/2026 18:59:41');
    expect(formatShortTime('2026-05-29 00:59:41')).toBe('18:59');
    expect(formatTime('2026-05-29 00:59:41')).toBe('05/28/2026 @ 18:59:41');
  });

  // 2026-01-15 07:30:00 UTC === 2026-01-15 00:30:00 MST (UTC-7, winter) — DST-aware
  it('renders winter UTC timestamps in MST (UTC-7)', () => {
    expect(formatDateTime('2026-01-15 07:30:00')).toBe('01/15/2026 00:30:00');
    expect(formatShortTime('2026-01-15 07:30:00')).toBe('00:30');
  });

  it('handles ISO-with-Z and naive UTC identically', () => {
    expect(formatDateTime('2026-05-29T00:59:41.000Z')).toBe('05/28/2026 18:59:41');
  });
});

describe('datetime-local edit round-trip (MT wall-clock <-> UTC)', () => {
  it('renders a stored UTC instant as an MT wall-clock input value', () => {
    expect(toDatetimeLocalValue('2026-05-29 00:59:41')).toBe('2026-05-28T18:59');
  });

  it('converts an MT wall-clock input back to UTC for storage', () => {
    // Summer (MDT, UTC-6)
    expect(mtDatetimeLocalToUtc('2026-05-28T18:59')).toBe('2026-05-29 00:59:00');
    // Winter (MST, UTC-7)
    expect(mtDatetimeLocalToUtc('2026-01-15T00:30:00')).toBe('2026-01-15 07:30:00');
  });

  it('is lossless to the minute: UTC -> MT input -> UTC', () => {
    const stored = '2026-05-29 00:59:00';
    expect(mtDatetimeLocalToUtc(toDatetimeLocalValue(stored))).toBe(stored);
  });
});
