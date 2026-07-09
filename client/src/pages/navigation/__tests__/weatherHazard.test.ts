import { describe, it, expect } from 'vitest';
import { weatherHazardLabel } from '../weatherHazard';

describe('weatherHazardLabel', () => {
  it('flags icy conditions (freezing rain WMO 66)', () => {
    expect(weatherHazardLabel({ conditionCode: 66, windSpeed: 5 })).toBe('Icy conditions');
  });

  it('flags icy conditions (freezing drizzle WMO 56)', () => {
    expect(weatherHazardLabel({ conditionCode: 56, windSpeed: 5 })).toBe('Icy conditions');
  });

  it('flags snow (WMO 73)', () => {
    expect(weatherHazardLabel({ conditionCode: 73, windSpeed: 5 })).toBe('Snow');
  });

  it('flags high wind (>=35 mph)', () => {
    expect(weatherHazardLabel({ conditionCode: 0, windSpeed: 40 })).toBe('High wind');
  });

  it('does not flag wind just under the threshold', () => {
    expect(weatherHazardLabel({ conditionCode: 0, windSpeed: 34 })).toBeNull();
  });

  it('flags low visibility (fog WMO 45)', () => {
    expect(weatherHazardLabel({ conditionCode: 45, windSpeed: 5 })).toBe('Low visibility');
  });

  it('returns null for clear conditions', () => {
    expect(weatherHazardLabel({ conditionCode: 0, windSpeed: 5 })).toBeNull();
  });

  it('returns null when fields are null', () => {
    expect(weatherHazardLabel({ conditionCode: null, windSpeed: null })).toBeNull();
  });

  it('prioritizes ice over snow and wind', () => {
    expect(weatherHazardLabel({ conditionCode: 67, windSpeed: 50 })).toBe('Icy conditions');
  });
});
