import { describe, it, expect } from 'vitest';
import {
  planAttemptWindows,
  escalatePriorityForDeadline,
  daysUntilDeadline,
  clusterByProximity,
} from '../src/utils/serveDiligencePlanner';

// 2026-06-11 is a Thursday. 18:00 UTC = 12:00 in America/Denver (MDT).
const NOW = '2026-06-11T18:00:00.000Z';

describe('daysUntilDeadline', () => {
  it('returns null without a deadline or on a non-date', () => {
    expect(daysUntilDeadline(NOW, null)).toBeNull();
    expect(daysUntilDeadline(NOW, '21 days')).toBeNull();
  });
  it('counts whole days to end-of-day on the deadline', () => {
    expect(daysUntilDeadline(NOW, '2026-06-11')).toBe(0);
    expect(daysUntilDeadline(NOW, '2026-06-14')).toBe(3);
  });
  it('goes negative when past', () => {
    expect(daysUntilDeadline(NOW, '2026-06-01')).toBeLessThan(0);
  });
});

describe('planAttemptWindows', () => {
  it('normal cadence: tomorrow evening, +2 morning, next Saturday', () => {
    const plan = planAttemptWindows(NOW, null);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ attempt: 1, date: '2026-06-12', weekday: 'Fri', window: '17:00–20:30' });
    expect(plan[1]).toMatchObject({ attempt: 2, date: '2026-06-13', weekday: 'Sat', window: '07:00–09:00' });
    // Next Saturday at least 3 days out from Thu 06-11 → 06-20.
    expect(plan[2]).toMatchObject({ attempt: 3, date: '2026-06-20', weekday: 'Sat', window: '10:00–14:00' });
  });

  it('tight deadline compresses to daily attempts starting today', () => {
    const plan = planAttemptWindows(NOW, '2026-06-14');
    expect(plan[0].date).toBe('2026-06-11');
    expect(plan[1].date).toBe('2026-06-12');
    expect(plan[2].date).toBe('2026-06-13');
  });

  it('never schedules an attempt after the deadline', () => {
    const plan = planAttemptWindows(NOW, '2026-06-12');
    for (const w of plan) {
      expect(w.date <= '2026-06-12').toBe(true);
    }
  });
});

describe('escalatePriorityForDeadline', () => {
  it('escalates to urgent inside 3 days', () => {
    expect(escalatePriorityForDeadline('normal', NOW, '2026-06-13')).toBe('urgent');
  });
  it('escalates to rush inside 7 days', () => {
    expect(escalatePriorityForDeadline('routine', NOW, '2026-06-17')).toBe('rush');
  });
  it('never downgrades a higher client-requested priority', () => {
    expect(escalatePriorityForDeadline('urgent', NOW, '2026-09-01')).toBe('urgent');
  });
  it('leaves priority alone with no deadline or a far one', () => {
    expect(escalatePriorityForDeadline('normal', NOW, null)).toBe('normal');
    expect(escalatePriorityForDeadline('normal', NOW, '2026-09-01')).toBe('normal');
  });
});

describe('clusterByProximity', () => {
  it('returns a 3-decimal lat/lng cluster id when coordinates are present', () => {
    expect(clusterByProximity(40.76078, -111.89105, '84101')).toBe('g-40.760--111.891');
  });
  it('truncates rather than rounds so boundary-straddling coords stay in their own cells', () => {
    const a = clusterByProximity(40.7609, -111.8919, null);
    const b = clusterByProximity(40.7611, -111.8919, null);
    // With rounding, both would map to 40.761 — a false same-cell grouping
    // across a boundary. Truncation correctly keeps each in its own cell.
    expect(a).toBe('g-40.760--111.891');
    expect(b).toBe('g-40.761--111.891');
  });
  it('falls back to ZIP when lat/lng is missing', () => {
    expect(clusterByProximity(null, null, '84101')).toBe('z-84101');
    expect(clusterByProximity(null, null, '84101-1234')).toBe('z-84101');
  });
  it('returns null when nothing is known about location', () => {
    expect(clusterByProximity(null, null, null)).toBeNull();
    expect(clusterByProximity(null, null, '')).toBeNull();
  });
});
