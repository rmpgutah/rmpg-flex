import { describe, it, expect } from 'vitest';
import {
  buildDateWindow,
  computeCostBreakdown,
  computeMpgPoints,
  zScores,
  type FuelEntry,
} from '../src/utils/fleetViz';

// ─── buildDateWindow ──────────────────────────────────────

describe('buildDateWindow', () => {
  it('30d (default) emits a "-30 days" date() fragment', () => {
    const w = buildDateWindow(undefined, 'fuel_date');
    expect(w.whereClause).toContain("date('now','-30 days')");
    expect(w.whereClause).toContain('AND fuel_date');
    expect(w.label).toBe('Last 30 days');
  });

  it('7d / 90d / 1y route to the right day count', () => {
    expect(buildDateWindow('7d', 'fuel_date').whereClause).toContain("-7 days");
    expect(buildDateWindow('90d', 'fuel_date').whereClause).toContain("-90 days");
    expect(buildDateWindow('1y', 'fuel_date').whereClause).toContain("-365 days");
  });

  it('ytd emits "start of year"', () => {
    const w = buildDateWindow('ytd', 'fuel_date');
    expect(w.whereClause).toContain("start of year");
    expect(w.label).toBe('Year to date');
  });

  it('all returns an empty whereClause (no filter)', () => {
    const w = buildDateWindow('all', 'fuel_date');
    expect(w.whereClause).toBe('');
    expect(w.label).toBe('All time');
  });

  it('unknown period defaults to 30 days', () => {
    expect(buildDateWindow('mystery', 'fuel_date').label).toBe('Last 30 days');
  });

  it('respects column hygiene — rejects bad identifiers', () => {
    expect(() => buildDateWindow('30d', "fuel_date'; DROP TABLE")).toThrow(/invalid column/);
    expect(() => buildDateWindow('30d', 'BAD UPPER')).toThrow();
    expect(() => buildDateWindow('30d', '1bad')).toThrow();
  });
});

// ─── computeCostBreakdown ─────────────────────────────────

describe('computeCostBreakdown', () => {
  it('sums + rounds to 2 decimals + computes cost-per-mile', () => {
    const out = computeCostBreakdown({ fuel_cost: 100.234, maintenance_cost: 50.5, parts_cost: 25, miles_driven: 1500 });
    expect(out.fuel).toBe(100.23);
    expect(out.maintenance).toBe(50.5);
    expect(out.parts).toBe(25);
    expect(out.total).toBe(175.73);
    expect(out.cost_per_mile).toBe(0.1172);
  });

  it('returns null cost_per_mile when miles_driven is 0', () => {
    expect(computeCostBreakdown({ fuel_cost: 100, maintenance_cost: 0, parts_cost: 0, miles_driven: 0 }).cost_per_mile).toBeNull();
  });

  it('handles all-zero inputs cleanly', () => {
    const out = computeCostBreakdown({ fuel_cost: 0, maintenance_cost: 0, parts_cost: 0, miles_driven: 0 });
    expect(out).toEqual({ fuel: 0, maintenance: 0, parts: 0, total: 0, cost_per_mile: null });
  });
});

// ─── computeMpgPoints ─────────────────────────────────────

const f = (overrides: Partial<FuelEntry>): FuelEntry => ({
  id: 0, fuel_date: '2026-01-01', gallons: null, odometer: null,
  is_full_tank: null, is_partial_fillup: null, ...overrides,
});

describe('computeMpgPoints', () => {
  it('returns [] on empty input', () => {
    expect(computeMpgPoints([])).toEqual([]);
  });

  it('returns [] when only one full tank is present (no interval to close)', () => {
    expect(computeMpgPoints([f({ id: 1, gallons: 10, odometer: 1000, is_full_tank: 1 })])).toEqual([]);
  });

  it('closes a single interval between two consecutive full tanks', () => {
    const out = computeMpgPoints([
      f({ id: 1, fuel_date: '2026-01-01', gallons: 10, odometer: 1000, is_full_tank: 1 }),
      f({ id: 2, fuel_date: '2026-01-15', gallons: 12, odometer: 1300, is_full_tank: 1 }),
    ]);
    // 1300 - 1000 = 300 miles; gallons used to fill = 12 (the close itself; the
    // first tank just established the baseline). 300/12 = 25 mpg.
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ miles: 300, gallons: 12, mpg: 25, closing_entry_id: 2 });
  });

  it('rolls partial fillups into the closing interval', () => {
    const out = computeMpgPoints([
      f({ id: 1, fuel_date: '2026-01-01', gallons: 10, odometer: 1000, is_full_tank: 1 }),
      f({ id: 2, fuel_date: '2026-01-08', gallons: 5,  odometer: 1150, is_partial_fillup: 1 }),
      f({ id: 3, fuel_date: '2026-01-15', gallons: 7,  odometer: 1300, is_full_tank: 1 }),
    ]);
    // 1300-1000 = 300 miles; gallons = 5 (partial) + 7 (closing full) = 12 → 25 mpg
    expect(out).toHaveLength(1);
    expect(out[0].mpg).toBe(25);
    expect(out[0].gallons).toBe(12);
  });

  it('skips an interval when odometer went BACKWARDS (rollback / data entry)', () => {
    const out = computeMpgPoints([
      f({ id: 1, gallons: 10, odometer: 1000, is_full_tank: 1 }),
      f({ id: 2, gallons: 12, odometer: 900, is_full_tank: 1 }),
    ]);
    expect(out).toEqual([]);
  });

  it('skips an interval with zero gallons (division-by-zero guard)', () => {
    const out = computeMpgPoints([
      f({ id: 1, gallons: 10, odometer: 1000, is_full_tank: 1 }),
      f({ id: 2, gallons: 0,  odometer: 1300, is_full_tank: 1 }),
    ]);
    expect(out).toEqual([]);
  });

  it('handles multiple intervals back-to-back', () => {
    const out = computeMpgPoints([
      f({ id: 1, gallons: 10, odometer: 1000, is_full_tank: 1 }),
      f({ id: 2, gallons: 12, odometer: 1300, is_full_tank: 1 }),  // 25 mpg
      f({ id: 3, gallons: 15, odometer: 1750, is_full_tank: 1 }),  // 30 mpg
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].mpg).toBe(25);
    expect(out[1].mpg).toBe(30);
  });
});

// ─── zScores ─────────────────────────────────────────────

describe('zScores', () => {
  it('returns [] on series of length < 2', () => {
    expect(zScores([])).toEqual([]);
    expect(zScores([5])).toEqual([]);
  });

  it('returns all-zeros when std is 0 (every value identical)', () => {
    expect(zScores([5, 5, 5, 5])).toEqual([0, 0, 0, 0]);
  });

  it('correctly computes z-scores for a known sequence', () => {
    // [10, 20, 30, 40, 50] → mean=30, std=√200=14.14...
    const out = zScores([10, 20, 30, 40, 50]);
    expect(out[0]).toBeCloseTo(-1.41, 1);  // (10-30)/14.14
    expect(out[2]).toBe(0);
    expect(out[4]).toBeCloseTo(1.41, 1);
  });

  it('flags outliers (|z| > 2)', () => {
    const series = [10, 10, 10, 10, 10, 10, 10, 10, 10, 100];
    const out = zScores(series);
    expect(Math.abs(out[9])).toBeGreaterThan(2); // 100 is the outlier
  });
});
