import { describe, it, expect } from 'vitest';
import { normalizePlate, formatScore } from '../src/utils/plateTrust';

describe('normalizePlate', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(normalizePlate(' kjh-345 ')).toBe('KJH345');
  });
  it('maps ambiguous glyphs to a canonical form for comparison', () => {
    expect(normalizePlate('OISBZ')).toBe('01582');
  });
});

describe('formatScore', () => {
  it('matches a CA plate (1ABC234) and names the jurisdiction', () => {
    const r = formatScore('5KJH345');
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.jurisdiction).toBe('CA');
  });
  it('penalizes a string that matches no known format', () => {
    expect(formatScore('!!').score).toBeLessThan(0.3);
  });
});
