// Mandatory Mountain Time — these lock in that stored UTC timestamps always
// display in America/Denver (DST-aware) and that the datetime-local edit
// round-trip is lossless, regardless of the CI runner's timezone.
import { describe, it, expect, vi } from 'vitest';
import {
  parseTimestamp,
  todayRange,
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

// Run this suite under UTC, America/Denver and Asia/Tokyo: no device-local
// parsing is allowed to change an instant or a Denver calendar boundary.
describe('timestamp and timeframe regression', () => {
  it.each([
    '2026-09-09 18:30:00', '2026-09-09T18:30:00',
    '2026-09-09T18:30:00Z', '2026-09-09 12:30:00-06:00',
    '2026-09-09T12:30:00-0600',
  ])('preserves the same instant for %s', value => {
    expect(formatShortTime(value)).toBe('12:30');
  });

  it('keeps calendar-only dates in Denver', () => {
    expect(formatDateTime('2026-09-09')).toBe('09/09/2026 00:00:00');
    expect(mtDatetimeLocalToUtc('2026-09-09')).toBe('2026-09-09 06:00:00');
    expect(Number.isNaN(parseTimestamp('').getTime())).toBe(true);
    expect(Number.isNaN(parseTimestamp('bad timestamp').getTime())).toBe(true);
  });

  it('resolves the offset after spring and fall transitions', () => {
    expect(mtDatetimeLocalToUtc('2026-03-08T03:30')).toBe('2026-03-08 09:30:00');
    expect(mtDatetimeLocalToUtc('2026-11-01T02:30')).toBe('2026-11-01 09:30:00');
    expect(mtDatetimeLocalToUtc('2026-03-08T02:30')).toBe('');
    expect(mtDatetimeLocalToUtc('2026-11-01T01:30')).toBe('2026-11-01 07:30:00');
  });
});


describe('Denver day ranges', () => {
  it.each([
    ['2026-09-10T02:00:00Z', '2026-09-09 06:00:00', '2026-09-10 05:59:59', 24],
    ['2026-03-08T18:00:00Z', '2026-03-08 07:00:00', '2026-03-09 05:59:59', 23],
    ['2026-11-01T18:00:00Z', '2026-11-01 06:00:00', '2026-11-02 06:59:59', 25],
  ])('uses the actual calendar-day duration at %s', (now, start, end, hours) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(parseTimestamp(now));
      expect(todayRange()).toEqual({ start, end });
      expect(parseTimestamp(end).getTime() - parseTimestamp(start).getTime() + 1000).toBe(Number(hours) * 3600000);
    } finally { vi.useRealTimers(); }
  });
});
