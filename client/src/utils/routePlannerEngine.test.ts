import { describe, it, expect } from 'vitest';
import { ROUTE_PLANNER_FEATURES, ROUTE_PLANNER_FIXES } from './routePlannerCatalog';
import {
  applyLunchBreak,
  catalogCounts,
  dwellTypeShort,
  formatRunBreakdown,
  gallonsForMiles,
  googleMapsNavUrl,
  hasEveningWindow,
  hoursUntilDeadline,
  mergeLockedVisitOrder,
  nextUnservedJob,
  splitIdsByShiftMinutes,
} from './routePlannerEngine';

describe('Route Planner catalog', () => {
  it('names 25 fixes and 10 features', () => {
    expect(ROUTE_PLANNER_FIXES).toHaveLength(25);
    expect(ROUTE_PLANNER_FEATURES).toHaveLength(10);
    expect(catalogCounts()).toEqual({ fixes: 25, features: 10 });
  });
});

describe('applyLunchBreak', () => {
  it('adds 30 minutes once after noon Denver', () => {
    const beforeNoon = Date.parse('2026-08-28T17:00:00.000Z'); // 11:00 MDT
    const first = applyLunchBreak(beforeNoon, false, 30);
    expect(first.lunchTaken).toBe(false);
    const afterNoon = Date.parse('2026-08-28T18:30:00.000Z'); // 12:30 MDT
    const second = applyLunchBreak(afterNoon, false, 30);
    expect(second.lunchTaken).toBe(true);
    expect(second.addedMs).toBe(30 * 60_000);
  });
});

describe('splitIdsByShiftMinutes', () => {
  it('cuts before the stop that would exceed 8 hours', () => {
    const { day1, day2 } = splitIdsByShiftMinutes([1, 2, 3, 4], [60, 200, 500, 620], 480);
    expect(day1).toEqual([1, 2]);
    expect(day2).toEqual([3, 4]);
  });
});

describe('mergeLockedVisitOrder', () => {
  it('keeps a pinned stop in its original slot', () => {
    expect(mergeLockedVisitOrder([1, 2, 3, 4], [4, 3, 2, 1], new Set([2]))).toEqual([4, 2, 3, 1]);
  });
});

describe('nextUnservedJob / nav / fuel / evening', () => {
  it('skips served prefix', () => {
    const next = nextUnservedJob([
      { id: 1, status: 'served' },
      { id: 2, status: 'pending' },
    ]);
    expect(next?.id).toBe(2);
  });
  it('builds a Google Maps destination URL', () => {
    expect(googleMapsNavUrl(40.76, -111.89)).toContain('destination=40.76,-111.89');
  });
  it('estimates gallons', () => {
    expect(gallonsForMiles(18, 18)).toBe(1);
  });
  it('flags evening windows', () => {
    expect(hasEveningWindow('evening')).toBe(true);
    expect(hasEveningWindow('morning')).toBe(false);
  });
  it('counts hours to deadline', () => {
    const hours = hoursUntilDeadline('2026-08-29T06:00:00.000Z', Date.parse('2026-08-28T18:00:00.000Z'));
    expect(hours).toBe(12);
  });
  it('labels dwell type and run breakdown', () => {
    expect(dwellTypeShort('apartment')).toBe('Apt');
    expect(formatRunBreakdown({ drive: 90, dwell: 36, wait: 12, lunch: 30 }))
      .toBe('90m drive · 36m on-site · 12m window wait · 30m lunch');
  });
});
