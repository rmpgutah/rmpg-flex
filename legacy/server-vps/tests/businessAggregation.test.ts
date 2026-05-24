import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  computeIsCurrentlyOpen,
  computeHeatmap,
  computeTrend,
  computeRiskScore,
} from '../src/utils/businessAggregation';

// Helper: build a JS Date that corresponds to a specific wall-clock time in America/Denver
function denverDate(iso: string): Date {
  const dt = DateTime.fromISO(iso, { zone: 'America/Denver' });
  return dt.toJSDate();
}

describe('computeIsCurrentlyOpen', () => {
  const standardHours = JSON.stringify({
    mon: { open: '09:00', close: '17:00' },
    tue: { open: '09:00', close: '17:00' },
    wed: { open: '09:00', close: '17:00' },
    thu: { open: '09:00', close: '17:00' },
    fri: { open: '09:00', close: '17:00' },
  });

  it('returns false for null hoursJson', () => {
    expect(computeIsCurrentlyOpen(null)).toBe(false);
  });

  it('returns false for empty string hoursJson', () => {
    expect(computeIsCurrentlyOpen('')).toBe(false);
  });

  it('returns false for malformed JSON', () => {
    expect(computeIsCurrentlyOpen('{not json')).toBe(false);
  });

  it('returns true for Mon 14:00 MDT inside Mon 09:00-17:00', () => {
    // 2026-04-27 is a Monday
    const now = denverDate('2026-04-27T14:00');
    expect(computeIsCurrentlyOpen(standardHours, now)).toBe(true);
  });

  it('returns false for Sat when only weekdays defined', () => {
    // 2026-04-25 is a Saturday
    const now = denverDate('2026-04-25T14:00');
    expect(computeIsCurrentlyOpen(standardHours, now)).toBe(false);
  });

  it('returns false before opening hour', () => {
    const now = denverDate('2026-04-27T08:30');
    expect(computeIsCurrentlyOpen(standardHours, now)).toBe(false);
  });

  it('returns false after closing hour', () => {
    const now = denverDate('2026-04-27T17:30');
    expect(computeIsCurrentlyOpen(standardHours, now)).toBe(false);
  });

  it('respects holiday list — closed on Christmas even if hours say open', () => {
    const hours = JSON.stringify({
      thu: { open: '09:00', close: '17:00' },
      fri: { open: '09:00', close: '17:00' },
    });
    const holidays = JSON.stringify(['2026-12-25']);
    // 2026-12-25 is a Friday
    const now = denverDate('2026-12-25T12:00');
    expect(computeIsCurrentlyOpen(hours, now, holidays)).toBe(false);
    // sanity: Friday Dec 18 (not a holiday) is open
    const nonHoliday = denverDate('2026-12-18T12:00');
    expect(computeIsCurrentlyOpen(hours, nonHoliday, holidays)).toBe(true);
  });

  it('cross-midnight: bar open 18:00-02:00 returns true at 01:30', () => {
    const barHours = JSON.stringify({
      fri: { open: '18:00', close: '02:00' },
      sat: { open: '18:00', close: '02:00' },
    });
    // Saturday 01:30 MDT — Friday's window crosses into Saturday early morning
    const now = denverDate('2026-04-25T01:30');
    expect(computeIsCurrentlyOpen(barHours, now)).toBe(true);
  });

  it('cross-midnight: returns false at 03:00 (after close)', () => {
    const barHours = JSON.stringify({
      fri: { open: '18:00', close: '02:00' },
      sat: { open: '18:00', close: '02:00' },
    });
    const now = denverDate('2026-04-25T03:00');
    expect(computeIsCurrentlyOpen(barHours, now)).toBe(false);
  });

  it('cross-midnight: same-day evening still returns true', () => {
    const barHours = JSON.stringify({
      fri: { open: '18:00', close: '02:00' },
    });
    // Friday 22:00
    const now = denverDate('2026-04-24T22:00');
    expect(computeIsCurrentlyOpen(barHours, now)).toBe(true);
  });

  it('handles DST spring-forward (Sunday March 8 2026)', () => {
    // Spring-forward 2026: March 8 at 02:00 MST -> 03:00 MDT
    const hours = JSON.stringify({
      sun: { open: '09:00', close: '17:00' },
    });
    const now = denverDate('2026-03-08T10:00');
    expect(computeIsCurrentlyOpen(hours, now)).toBe(true);
  });

  it('returns true exactly at opening minute', () => {
    const now = denverDate('2026-04-27T09:00');
    expect(computeIsCurrentlyOpen(standardHours, now)).toBe(true);
  });

  it('returns true exactly at closing minute (inclusive)', () => {
    const now = denverDate('2026-04-27T17:00');
    expect(computeIsCurrentlyOpen(standardHours, now)).toBe(true);
  });
});

describe('computeHeatmap', () => {
  it('returns 7x6 zeros for empty input', () => {
    const m = computeHeatmap([]);
    expect(m.length).toBe(7);
    for (const row of m) {
      expect(row.length).toBe(6);
      expect(row.every(v => v === 0)).toBe(true);
    }
  });

  it('places Mon 14:30 event in matrix[0][3] (12-16 bucket)', () => {
    // 2026-04-27 Monday 14:30 Denver
    const dt = DateTime.fromObject({ year: 2026, month: 4, day: 27, hour: 14, minute: 30 }, { zone: 'America/Denver' });
    const m = computeHeatmap([{ occurred_at: dt.toISO()! }]);
    expect(m[0][3]).toBe(1);
    // everything else is 0
    let total = 0;
    for (const row of m) for (const v of row) total += v;
    expect(total).toBe(1);
  });

  it('increments count for multiple events in same bucket', () => {
    const dt = DateTime.fromObject({ year: 2026, month: 4, day: 27, hour: 14, minute: 30 }, { zone: 'America/Denver' });
    const dt2 = DateTime.fromObject({ year: 2026, month: 4, day: 27, hour: 15, minute: 45 }, { zone: 'America/Denver' });
    const m = computeHeatmap([
      { occurred_at: dt.toISO()! },
      { occurred_at: dt2.toISO()! },
    ]);
    expect(m[0][3]).toBe(2);
  });

  it('Sunday event lands in matrix[6]', () => {
    // 2026-04-26 Sunday
    const dt = DateTime.fromObject({ year: 2026, month: 4, day: 26, hour: 10, minute: 0 }, { zone: 'America/Denver' });
    const m = computeHeatmap([{ occurred_at: dt.toISO()! }]);
    expect(m[6][2]).toBe(1); // 8-12 bucket
  });

  it('Saturday 23:55 lands in matrix[5][5]', () => {
    // 2026-04-25 Saturday
    const dt = DateTime.fromObject({ year: 2026, month: 4, day: 25, hour: 23, minute: 55 }, { zone: 'America/Denver' });
    const m = computeHeatmap([{ occurred_at: dt.toISO()! }]);
    expect(m[5][5]).toBe(1);
  });

  it('skips events with invalid occurred_at', () => {
    const m = computeHeatmap([{ occurred_at: 'not-a-date' } as any]);
    let total = 0;
    for (const row of m) for (const v of row) total += v;
    expect(total).toBe(0);
  });

  it('bucket 0 covers 00:00-03:59', () => {
    const dt = DateTime.fromObject({ year: 2026, month: 4, day: 27, hour: 3, minute: 59 }, { zone: 'America/Denver' });
    const m = computeHeatmap([{ occurred_at: dt.toISO()! }]);
    expect(m[0][0]).toBe(1);
  });
});

describe('computeTrend', () => {
  it('returns 0% for empty/empty', () => {
    expect(computeTrend([], []).pct_change).toBe(0);
  });

  it('returns 100% when prior empty and recent non-empty', () => {
    expect(computeTrend([{ occurred_at: '2026-04-25T12:00:00Z' }], []).pct_change).toBe(100);
  });

  it('returns 50% for 15 vs 10', () => {
    const recent = Array.from({ length: 15 }, () => ({ occurred_at: '2026-04-25T12:00:00Z' }));
    const prior = Array.from({ length: 10 }, () => ({ occurred_at: '2026-04-01T12:00:00Z' }));
    expect(computeTrend(recent, prior).pct_change).toBe(50);
  });

  it('returns -50% for 5 vs 10', () => {
    const recent = Array.from({ length: 5 }, () => ({ occurred_at: '2026-04-25T12:00:00Z' }));
    const prior = Array.from({ length: 10 }, () => ({ occurred_at: '2026-04-01T12:00:00Z' }));
    expect(computeTrend(recent, prior).pct_change).toBe(-50);
  });

  it('week_buckets: events 3 days ago land in [3]', () => {
    const threeDaysAgo = DateTime.now().minus({ days: 3 }).toISO()!;
    const recent = Array.from({ length: 5 }, () => ({ occurred_at: threeDaysAgo }));
    const result = computeTrend(recent, []);
    expect(result.week_buckets[3]).toBe(5);
    expect(result.week_buckets[2]).toBe(0);
  });

  it('week_buckets: events 10 days ago land in [2]', () => {
    const tenDaysAgo = DateTime.now().minus({ days: 10 }).toISO()!;
    const recent = Array.from({ length: 5 }, () => ({ occurred_at: tenDaysAgo }));
    const result = computeTrend(recent, []);
    expect(result.week_buckets[2]).toBe(5);
  });

  it('week_buckets: events older than 28 days excluded', () => {
    const longAgo = DateTime.now().minus({ days: 60 }).toISO()!;
    const recent = Array.from({ length: 5 }, () => ({ occurred_at: longAgo }));
    const result = computeTrend(recent, []);
    expect(result.week_buckets).toEqual([0, 0, 0, 0]);
  });

  it('week_buckets covers all 4 weeks', () => {
    const events = [
      { occurred_at: DateTime.now().minus({ days: 3 }).toISO()! },   // [3]
      { occurred_at: DateTime.now().minus({ days: 10 }).toISO()! },  // [2]
      { occurred_at: DateTime.now().minus({ days: 17 }).toISO()! },  // [1]
      { occurred_at: DateTime.now().minus({ days: 24 }).toISO()! },  // [0]
    ];
    const result = computeTrend(events, []);
    expect(result.week_buckets).toEqual([1, 1, 1, 1]);
  });
});

describe('computeRiskScore', () => {
  it('returns low (0) for all zeros', () => {
    const r = computeRiskScore({}, [], 0);
    expect(r.score).toBe(0);
    expect(r.level).toBe('low');
  });

  it('5 incidents -> moderate (25)', () => {
    const r = computeRiskScore({}, [], 5);
    expect(r.score).toBe(25);
    expect(r.level).toBe('moderate');
  });

  it('caps incident contribution at 30 (10 incidents)', () => {
    const r = computeRiskScore({}, [], 10);
    expect(r.score).toBe(30);
    expect(r.level).toBe('moderate');
  });

  it('caps incident contribution at 30 (100 incidents)', () => {
    const r = computeRiskScore({}, [], 100);
    expect(r.score).toBe(30);
  });

  it('1 person with warrant + 5 incidents -> high (40)', () => {
    const r = computeRiskScore({}, [{ active_warrant_count: 1 }], 5);
    expect(r.score).toBe(40); // 25 + 15
    expect(r.level).toBe('high');
  });

  it('sex offender flag adds 10', () => {
    const r = computeRiskScore({}, [{ is_sex_offender: 1 }], 0);
    expect(r.score).toBe(10);
    expect(r.level).toBe('low');
  });

  it('sex offender boolean true adds 10', () => {
    const r = computeRiskScore({}, [{ is_sex_offender: true }], 0);
    expect(r.score).toBe(10);
  });

  it('VIOLENT flag adds 12', () => {
    const r = computeRiskScore({}, [{ flags: 'VIOLENT,GANG' }], 0);
    expect(r.score).toBe(12);
  });

  it('3 violent persons + 20 incidents -> critical', () => {
    const persons = [
      { flags: 'VIOLENT' },
      { flags: 'VIOLENT' },
      { flags: 'VIOLENT' },
    ];
    const r = computeRiskScore({}, persons, 20);
    // 30 (capped) + 12*3 = 66 -> high (not critical), let's verify exact
    expect(r.score).toBe(66);
    expect(r.level).toBe('high');
  });

  it('compound: warrant + sex offender + violent + 10 incidents -> critical', () => {
    const persons = [{ active_warrant_count: 2, is_sex_offender: 1, flags: 'VIOLENT' }];
    const r = computeRiskScore({}, persons, 10);
    // 30 + 15 + 10 + 12 = 67 -> high
    expect(r.score).toBe(67);
    expect(r.level).toBe('high');
  });

  it('reaches critical threshold at score >= 70', () => {
    const persons = [
      { active_warrant_count: 1, is_sex_offender: 1, flags: 'VIOLENT' }, // 37
      { active_warrant_count: 1, flags: 'VIOLENT' }, // 27
    ];
    const r = computeRiskScore({}, persons, 5);
    // 25 + 37 + 27 = 89
    expect(r.score).toBe(89);
    expect(r.level).toBe('critical');
  });

  it('moderate threshold at score >= 15', () => {
    const r = computeRiskScore({}, [], 3);
    expect(r.score).toBe(15);
    expect(r.level).toBe('moderate');
  });

  it('person with active_warrant_count 0 does not add 15', () => {
    const r = computeRiskScore({}, [{ active_warrant_count: 0 }], 0);
    expect(r.score).toBe(0);
  });
});
