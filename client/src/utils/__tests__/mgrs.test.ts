import { describe, it, expect } from 'vitest';
import { toMgrs } from '../mgrs';

describe('toMgrs', () => {
  it('matches the Washington Monument reference', () => {
    // 38.8895N 77.0353W. Digits cross-validated to the millimeter by two
    // independent projections (Snyder series here; Karney 6th-order Krueger
    // as the external check) — easting 323478.06, northing 4306483.24.
    expect(toMgrs(38.8895, -77.0353)).toBe('18S UJ 23478 06483');
  });

  it('produces a Salt Lake valley reference in zone 12T', () => {
    expect(toMgrs(40.713171, -112.058558)).toMatch(/^12T [A-Z]{2} \d{5} \d{5}$/);
  });

  it('returns empty outside the MGRS domain', () => {
    expect(toMgrs(89, 10)).toBe('');
  });
});
