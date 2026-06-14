import { describe, it, expect } from 'vitest';
import { normalizePlate, formatScore, consensus } from '../src/utils/plateTrust';

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

describe('consensus', () => {
  it('picks the majority canonical read and reports the agreement ratio', () => {
    const r = consensus(['KJH345', 'KJH345', '5KJH345', 'KJH345']);
    expect(r.canonical).toBe('KJH345');
    expect(r.ratio).toBeCloseTo(0.75, 2);
    expect(r.variants).toEqual([{ plate: '5KJH345', count: 1 }]);
  });
  it('a single read has ratio 1 but no corroboration (one vote)', () => {
    const r = consensus(['ABC123']);
    expect(r.canonical).toBe('ABC123');
    expect(r.ratio).toBe(1);
    expect(r.readCount).toBe(1);
  });
});
