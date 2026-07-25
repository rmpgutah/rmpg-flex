import { describe, it, expect } from 'vitest';
import { hasFix } from '../useUnitLocations';

describe('hasFix', () => {
  it('rejects a NULL coordinate — the Null Island bug', () => {
    // D1 returns SQL NULL for a unit with no GPS. Number(null) === 0, which is
    // finite, so the old Number.isFinite guard let it through and the app
    // reverse-geocoded 0,0 on every Dispatch load.
    expect(hasFix(null, null)).toBe(false);
    expect(hasFix(null, -111.88)).toBe(false);
    expect(hasFix(40.69, null)).toBe(false);
  });

  it('rejects exact 0,0 even when both values are present', () => {
    expect(hasFix(0, 0)).toBe(false);
    expect(hasFix('0', '0')).toBe(false);
  });

  it('rejects undefined, empty string, and non-numeric junk', () => {
    expect(hasFix(undefined, undefined)).toBe(false);
    expect(hasFix('', '')).toBe(false);
    expect(hasFix('abc', 'def')).toBe(false);
    expect(hasFix(NaN, NaN)).toBe(false);
  });

  it('rejects out-of-range coordinates as corrupt', () => {
    expect(hasFix(91, 0.5)).toBe(false);
    expect(hasFix(45, 181)).toBe(false);
  });

  it('accepts a real Salt Lake City fix, as number or string', () => {
    expect(hasFix(40.69450705, -111.88210737)).toBe(true);
    expect(hasFix('40.69450705', '-111.88210737')).toBe(true);
  });

  it('accepts a legitimate zero on one axis only', () => {
    // 0 latitude with a real longitude is a real place; only 0,0 is sentinel.
    expect(hasFix(0, -111.88)).toBe(true);
    expect(hasFix(40.69, 0)).toBe(true);
  });
});
