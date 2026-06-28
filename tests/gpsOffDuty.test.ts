import { describe, it, expect } from 'vitest';
import { _isUnitOffDutyForTest as isUnitOffDuty } from '../src/routes/dispatch/gps';

describe('isUnitOffDuty', () => {
  it('rejects pings when unit.status is off_duty', () => {
    expect(isUnitOffDuty('off_duty')).toBe(true);
  });

  it('rejects pings when unit.status is out_of_service', () => {
    expect(isUnitOffDuty('out_of_service')).toBe(true);
  });

  it('accepts pings for active patrol statuses', () => {
    for (const s of ['available', 'dispatched', 'enroute', 'onscene', 'busy']) {
      expect(isUnitOffDuty(s)).toBe(false);
    }
  });

  it('is case-insensitive against canonical lowercase set', () => {
    expect(isUnitOffDuty('OFF_DUTY')).toBe(true);
    expect(isUnitOffDuty('Off_Duty')).toBe(true);
    expect(isUnitOffDuty('Out_Of_Service')).toBe(true);
  });

  it('treats null/undefined/empty as "not off-duty" — caller decides via take-home flag', () => {
    expect(isUnitOffDuty(null)).toBe(false);
    expect(isUnitOffDuty(undefined)).toBe(false);
    expect(isUnitOffDuty('')).toBe(false);
  });

  it('does not match unknown statuses (defense against typos)', () => {
    expect(isUnitOffDuty('offline')).toBe(false);
    expect(isUnitOffDuty('off')).toBe(false);
    expect(isUnitOffDuty('inactive')).toBe(false);
  });
});
