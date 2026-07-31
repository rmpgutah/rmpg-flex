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
