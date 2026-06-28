// dutyRoster.test.ts
// Locks the GET /api/dispatch/duty/roster row contract that the iOS
// DutyRosterView decodes: unit/vehicle/last_gps are null (not {}) when absent,
// on_shift is derived from the open time entry, and hours_so_far comes from
// clock_in. The iOS side pattern-matches on nil, so {} vs null is breaking.
import { describe, it, expect } from 'vitest';
import { _rosterRowForTest as rosterRow } from '../src/routes/dispatch/duty';

describe('GET /api/dispatch/duty/roster — row shaping', () => {
  it('off-duty officer with no unit → nulls everywhere, on_shift false', () => {
    expect(rosterRow({ officer_id: 7, full_name: 'A. Officer', role: 'officer' }))
      .toEqual({
        officer_id: 7, name: 'A. Officer', role: 'officer',
        on_shift: false, entry_id: null, clock_in: null, hours_so_far: null,
        unit: null, vehicle: null, last_gps: null,
      });
  });

  it('on-duty officer → nested unit/vehicle/gps objects + computed hours', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, '+00:00');
    const row = rosterRow({
      officer_id: 3, full_name: 'B. Sgt', role: 'supervisor',
      entry_id: 99, clock_in: twoHoursAgo,
      unit_id: 5, call_sign: 'D19', unit_status: 'available', current_call_id: null,
      latitude: 40.7, longitude: -111.9, gps_updated_at: '2026-06-12 19:00:00',
      veh_id: 12, veh_number: 'PS-D19', veh_name: 'Tahoe',
    });
    expect(row.on_shift).toBe(true);
    expect(row.entry_id).toBe(99);
    expect(row.hours_so_far).toBeGreaterThan(1.95);
    expect(row.hours_so_far).toBeLessThan(2.05);
    expect(row.unit).toEqual({ id: 5, call_sign: 'D19', status: 'available', current_call_id: null });
    expect(row.vehicle).toEqual({ id: 12, vehicle_number: 'PS-D19', vehicle_name: 'Tahoe' });
    expect(row.last_gps).toEqual({ lat: 40.7, lng: -111.9, at: '2026-06-12 19:00:00' });
  });

  it('unparseable clock_in → on_shift true but hours_so_far null (never NaN to the client)', () => {
    const row = rosterRow({ officer_id: 1, full_name: 'C', role: 'officer', entry_id: 4, clock_in: 'garbage' });
    expect(row.on_shift).toBe(true);
    expect(row.hours_so_far).toBeNull();
  });
});
