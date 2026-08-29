import { describe, it, expect } from 'vitest';
import { convertValue, convertAll, CATEGORIES, CAD_PRESETS } from '../cadUnitConvert';

describe('cadUnitConvert', () => {
  it('converts miles to feet and lists every unit in the category', () => {
    expect(Math.round(convertValue('distance', 0, 3, 1))).toBe(5280);
    const all = convertAll('speed', 0, 60);
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.some((r) => r.label === 'MPH')).toBe(true);
  });

  it('exposes CAD presets and seven categories', () => {
    expect(CATEGORIES).toHaveLength(7);
    expect(CAD_PRESETS.find((p) => p.id === 'pursuit-60')).toBeTruthy();
  });
});
