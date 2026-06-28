import { describe, it, expect } from 'vitest';
import { summarizeInspection } from '../src/utils/vehicleInspection';

describe('vehicle inspection summary', () => {
  it('all pass → pass, no OOS', () => {
    const s = summarizeInspection([
      { item: 'Tires', status: 'pass' },
      { item: 'Lights', status: 'pass' },
    ]);
    expect(s.result).toBe('pass');
    expect(s.defects).toBe(0);
    expect(s.oos).toBe(false);
    expect(s.criticalItems).toEqual([]);
  });

  it('a minor/major defect fails but is not OOS', () => {
    const s = summarizeInspection([
      { item: 'Wipers', status: 'defect', severity: 'minor' },
      { item: 'Body', status: 'defect', severity: 'major' },
    ]);
    expect(s.result).toBe('fail');
    expect(s.defects).toBe(2);
    expect(s.oos).toBe(false);
  });

  it('a critical defect drives OOS and lists the item', () => {
    const s = summarizeInspection([
      { item: 'Tires', status: 'pass' },
      { item: 'Brakes', status: 'defect', severity: 'critical' },
    ]);
    expect(s.result).toBe('fail');
    expect(s.oos).toBe(true);
    expect(s.criticalItems).toContain('Brakes');
  });

  it('treats legacy "fail" status as a defect', () => {
    const s = summarizeInspection([{ item: 'Horn', status: 'fail' }]);
    expect(s.result).toBe('fail');
    expect(s.defects).toBe(1);
  });

  it('handles missing / empty input', () => {
    expect(summarizeInspection(undefined).result).toBe('pass');
    expect(summarizeInspection([]).oos).toBe(false);
  });
});
