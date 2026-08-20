import { describe, it, expect } from 'vitest';
import { denverDayBoundsUtc, denverToday, previousDenverDays } from '../src/utils/dailyReport/dates';

describe('denverDayBoundsUtc', () => {
  it('MST (winter) day is UTC-7', () => {
    expect(denverDayBoundsUtc('2026-01-15')).toEqual({
      startUtc: '2026-01-15 07:00:00',
      endUtc: '2026-01-16 07:00:00',
    });
  });

  it('MDT (summer) day is UTC-6', () => {
    expect(denverDayBoundsUtc('2026-07-18')).toEqual({
      startUtc: '2026-07-18 06:00:00',
      endUtc: '2026-07-19 06:00:00',
    });
  });

  // 2026-03-08 is the second Sunday in March — spring forward, a 23-hour day.
  it('spring-forward day spans 23 hours', () => {
    const b = denverDayBoundsUtc('2026-03-08');
    expect(b).toEqual({ startUtc: '2026-03-08 07:00:00', endUtc: '2026-03-09 06:00:00' });
    const hours = (Date.parse(b.endUtc + 'Z') - Date.parse(b.startUtc + 'Z')) / 3_600_000;
    expect(hours).toBe(23);
  });

  // 2026-11-01 is the first Sunday in November — fall back, a 25-hour day.
  it('fall-back day spans 25 hours', () => {
    const b = denverDayBoundsUtc('2026-11-01');
    expect(b).toEqual({ startUtc: '2026-11-01 06:00:00', endUtc: '2026-11-02 07:00:00' });
    const hours = (Date.parse(b.endUtc + 'Z') - Date.parse(b.startUtc + 'Z')) / 3_600_000;
    expect(hours).toBe(25);
  });

  it('emits D1 format, never ISO with T/Z', () => {
    const b = denverDayBoundsUtc('2026-07-18');
    expect(b.startUtc).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(b.startUtc).not.toContain('T');
    expect(b.startUtc).not.toContain('Z');
  });

  it('a 23:30 Mountain event falls inside that Denver day', () => {
    const { startUtc, endUtc } = denverDayBoundsUtc('2026-07-18');
    // 2026-07-18 23:30 MDT === 2026-07-19 05:30 UTC
    const event = '2026-07-19 05:30:00';
    expect(event >= startUtc && event < endUtc).toBe(true);
  });

  it('a 00:30 Mountain event falls outside the previous Denver day', () => {
    const { startUtc, endUtc } = denverDayBoundsUtc('2026-07-18');
    // 2026-07-19 00:30 MDT === 2026-07-19 06:30 UTC
    const event = '2026-07-19 06:30:00';
    expect(event >= startUtc && event < endUtc).toBe(false);
  });
});

describe('denverToday', () => {
  it('uses the Denver calendar day, not UTC', () => {
    // 2026-07-19 05:00 UTC is still 2026-07-18 23:00 in Denver.
    expect(denverToday(Date.parse('2026-07-19T05:00:00Z'))).toBe('2026-07-18');
  });
});

describe('previousDenverDays', () => {
  it('walks backward without duplicating or skipping', () => {
    expect(previousDenverDays('2026-07-18', 3)).toEqual(['2026-07-17', '2026-07-16', '2026-07-15']);
  });

  it('crosses a DST boundary cleanly', () => {
    expect(previousDenverDays('2026-11-02', 3)).toEqual(['2026-11-01', '2026-10-31', '2026-10-30']);
  });

  it('returns an empty list for n <= 0', () => {
    expect(previousDenverDays('2026-07-18', 0)).toEqual([]);
  });
});
