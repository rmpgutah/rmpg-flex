import { describe, it, expect } from 'vitest';
import {
  CORPORATE_ENHANCERS,
  overtimeFromPeriodHours,
  reconcileMileage,
  milesDelta,
  commuteVsBillable,
  resolveClockOfficerId,
  CLOCK_ON_BEHALF_ROLES,
  capBreakMinutes,
  minutesLate,
  payrollGross,
  isStaleOpenShift,
  isFatigueRisk,
  daysInclusive,
} from '../src/utils/corporateOps';

describe('corporate enhancer catalog', () => {
  it('lists exactly 90 enhancers with unique ids 1–90', () => {
    expect(CORPORATE_ENHANCERS).toHaveLength(90);
    const ids = CORPORATE_ENHANCERS.map((e) => e.id);
    expect(new Set(ids).size).toBe(90);
    expect(Math.min(...ids)).toBe(1);
    expect(Math.max(...ids)).toBe(90);
    for (const e of CORPORATE_ENHANCERS) {
      expect(e.feature.length).toBeGreaterThan(3);
      expect(e.change.length).toBeGreaterThan(8);
      expect(e.benefit.length).toBeGreaterThan(8);
    }
  });
});

describe('payroll overtime from period hours', () => {
  it('treats a 14-day period as two 40h weeks (80h cap)', () => {
    expect(daysInclusive('2026-08-01', '2026-08-14')).toBe(14);
    const split = overtimeFromPeriodHours(88, '2026-08-01', '2026-08-14');
    expect(split.regular_hours).toBe(80);
    expect(split.overtime_hours).toBe(8);
  });

  it('keeps hours under the cap as regular', () => {
    const split = overtimeFromPeriodHours(32, '2026-08-01', '2026-08-07');
    expect(split.regular_hours).toBe(32);
    expect(split.overtime_hours).toBe(0);
  });
});

describe('mileage reconcile', () => {
  it('flags GPS travel with a blank odometer', () => {
    const r = reconcileMileage({ duty_miles: 0, gps_trip_miles: 12, serve_billed_miles: 4, cfs_miles: 3 });
    expect(r.flag).toBe('gps_travel_no_odometer');
  });

  it('flags serve billed above duty miles', () => {
    const r = reconcileMileage({ duty_miles: 10, gps_trip_miles: 10, serve_billed_miles: 20, cfs_miles: 0 });
    expect(r.flag).toBe('serve_billed_exceeds_duty');
  });

  it('splits commute vs billable', () => {
    expect(commuteVsBillable(42, 18)).toEqual({ commute_miles: 24, billable_miles: 18 });
  });

  it('computes odometer delta without going negative', () => {
    expect(milesDelta(1000, 1042.4)).toBe(42.4);
    expect(milesDelta(2000, 1990)).toBe(0);
    expect(milesDelta(null, 10)).toBeNull();
  });
});

describe('clock IDOR resolver', () => {
  it('lets an officer punch only themselves', () => {
    const self = resolveClockOfficerId({ selfId: 7, requested: 99, role: 'officer', onBehalfRoles: CLOCK_ON_BEHALF_ROLES });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.code).toBe('CLOCK_IDOR');
  });

  it('lets dispatch clock another officer', () => {
    const ok = resolveClockOfficerId({ selfId: 1, requested: 9, role: 'dispatcher', onBehalfRoles: CLOCK_ON_BEHALF_ROLES });
    expect(ok).toEqual({ ok: true, officerId: 9 });
  });
});

describe('shift policy helpers', () => {
  it('caps forgotten breaks at 60 minutes', () => {
    expect(capBreakMinutes(180)).toBe(60);
  });

  it('applies an 8-minute tardy grace', () => {
    expect(minutesLate('2026-08-29T15:20:00Z', '2026-08-29T15:00:00Z')).toBe(12);
    expect(minutesLate('2026-08-29T15:05:00Z', '2026-08-29T15:00:00Z')).toBe(0);
  });

  it('computes payroll dollars from the rate card', () => {
    const pay = payrollGross({ regular_hours: 40, overtime_hours: 8, holiday_hours: 0, rate: 25, overtime_rate: 1.5 });
    expect(pay.base_pay).toBe(1000);
    expect(pay.overtime_pay).toBe(300);
    expect(pay.gross_pay).toBe(1300);
  });

  it('detects stale open shifts and fatigue rest', () => {
    const seventeenHoursAgo = new Date(Date.now() - 17 * 3600_000).toISOString();
    expect(isStaleOpenShift(seventeenHoursAgo)).toBe(true);
    expect(isFatigueRisk(6)).toBe(true);
    expect(isFatigueRisk(10)).toBe(false);
  });
});
