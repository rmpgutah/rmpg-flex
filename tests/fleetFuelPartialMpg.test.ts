import { describe, it, expect } from 'vitest';
import { computeFuelAnalytics } from '../src/routes/fleet';

// A partial fill does not reset the tank, so the distance since the previous
// fill was not burned from these gallons — the ratio simply isn't an MPG.
// computeFuelAnalytics has always refused to COMPUTE one for a partial fill
// (`isFull !== 0` on the odometer branch), but a stored `mpg` column bypassed
// that guard and fed avg/best/worst anyway.
function log(over: Record<string, unknown>) {
  return { id: 1, fuel_date: '2026-01-01T00:00:00', gallons: 10, odometer: 1000, total_cost: 30, is_full_tank: 1, mpg: null, ...over };
}

describe('computeFuelAnalytics — partial fills and the aggregates', () => {
  it('excludes a stored MPG on a partial fill from avg/best/worst', () => {
    const { summary } = computeFuelAnalytics([
      log({ id: 1, fuel_date: '2026-01-01T00:00:00', odometer: 1000 }),
      log({ id: 2, fuel_date: '2026-01-02T00:00:00', odometer: 1150, gallons: 10 }), // full: 15.0 mpg
      log({ id: 3, fuel_date: '2026-01-03T00:00:00', odometer: 1200, gallons: 2, is_full_tank: 0, mpg: 99 }),
    ]);
    expect(summary.best_mpg).toBe(15);
    expect(summary.avg_mpg).toBe(15);
    expect(summary.worst_mpg).toBe(15);
  });

  it('still reports the stored mpg on the partial row itself', () => {
    const { logs } = computeFuelAnalytics([
      log({ id: 1, odometer: 1000 }),
      log({ id: 2, fuel_date: '2026-01-03T00:00:00', odometer: 1200, gallons: 2, is_full_tank: 0, mpg: 99 }),
    ]);
    expect(logs.find((l) => l.id === 2)?.mpg).toBe(99);
  });

  it('still aggregates a stored MPG on a FULL fill that has no odometer basis', () => {
    const { summary } = computeFuelAnalytics([
      log({ id: 1, odometer: null, gallons: 10, is_full_tank: 1, mpg: 21 }),
    ]);
    expect(summary.avg_mpg).toBe(21);
  });

  it('is unchanged for a fleet of only full fills', () => {
    const { summary } = computeFuelAnalytics([
      log({ id: 1, fuel_date: '2026-01-01T00:00:00', odometer: 1000 }),
      log({ id: 2, fuel_date: '2026-01-02T00:00:00', odometer: 1100, gallons: 10 }), // 10.0
      log({ id: 3, fuel_date: '2026-01-03T00:00:00', odometer: 1300, gallons: 10 }), // 20.0
    ]);
    expect(summary.best_mpg).toBe(20);
    expect(summary.worst_mpg).toBe(10);
    expect(summary.avg_mpg).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Outlier exclusion. A bad odometer or a mistyped manual mpg yields a value the
// vehicle cannot have achieved, and Math.max/min surface exactly those as BEST
// and WORST MPG. The band is a ratio around the vehicle's OWN median, so it
// encodes no assumption about what the fleet drives.
// ---------------------------------------------------------------------------
describe('computeFuelAnalytics — implausible MPG readings', () => {
  // Ten believable pickup fills (median 10), plus the two live PS-D19 outliers.
  const believable = [9, 10, 11, 9.5, 10.5, 12, 8.5, 10, 11.5, 9];

  function seriesWith(extra: number[]) {
    const rows: Record<string, unknown>[] = [];
    let odo = 1000;
    let id = 0;
    for (const mpg of [...believable, ...extra]) {
      id += 1;
      // Drive mpg through the stored column so each row contributes exactly
      // the intended value regardless of odometer arithmetic.
      rows.push({
        id, fuel_date: `2026-01-${String(id).padStart(2, '0')}T00:00:00`,
        gallons: 10, odometer: (odo += 100), total_cost: 30, is_full_tank: 1, mpg,
      });
    }
    return rows;
  }

  it('excludes a 118.4 MPG reading from a truck averaging ~10', () => {
    const { summary } = computeFuelAnalytics(seriesWith([118.4]));
    expect(summary.best_mpg).toBe(12);
    expect(summary.mpg_outliers_excluded).toBe(1);
  });

  it('excludes a 0.2 MPG reading', () => {
    const { summary } = computeFuelAnalytics(seriesWith([0.2]));
    expect(summary.worst_mpg).toBe(8.5);
    expect(summary.mpg_outliers_excluded).toBe(1);
  });

  it('keeps plausible spread — a 21.9 highway tank survives', () => {
    const { summary } = computeFuelAnalytics(seriesWith([21.9]));
    expect(summary.best_mpg).toBe(21.9);
    expect(summary.mpg_outliers_excluded).toBe(0);
  });

  it('scales to the vehicle: 45 MPG is normal when the median is 45', () => {
    const rows = [40, 44, 45, 46, 50, 43, 47, 45, 44, 46].map((mpg, n) => ({
      id: n + 1, fuel_date: `2026-02-${String(n + 1).padStart(2, '0')}T00:00:00`,
      gallons: 4, odometer: 1000 + n * 100, total_cost: 12, is_full_tank: 1, mpg,
    }));
    const { summary } = computeFuelAnalytics(rows);
    expect(summary.best_mpg).toBe(50);
    expect(summary.mpg_outliers_excluded).toBe(0);
  });

  it('does not filter below the minimum sample — the median is not trustworthy yet', () => {
    const rows = [10, 118.4].map((mpg, n) => ({
      id: n + 1, fuel_date: `2026-03-0${n + 1}T00:00:00`,
      gallons: 10, odometer: 1000 + n * 100, total_cost: 30, is_full_tank: 1, mpg,
    }));
    const { summary } = computeFuelAnalytics(rows);
    expect(summary.best_mpg).toBe(118.4);
    expect(summary.mpg_outliers_excluded).toBe(0);
  });
});
