import { describe, it, expect } from 'vitest';
import { normalizePlate, formatScore, consensus, trustScore } from '../src/utils/plateTrust';

describe('normalizePlate', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(normalizePlate(' kjh-345 ')).toBe('KJH345');
  });
  it('maps ambiguous glyphs to a canonical form for comparison', () => {
    expect(normalizePlate('OISBZ')).toBe('01582');
  });
});

describe('formatScore', () => {
  it('matches a CA plate and names the jurisdiction', () => {
    // 5KJH345 matches CA ^\d[A-Z]{3}\d{3}$
    const r = formatScore('5KJH345');
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.jurisdiction).toBe('CA');
  });
  it('penalizes a string that matches no known format', () => {
    expect(formatScore('!!').score).toBeLessThan(0.3);
  });
  it('folds ambiguous glyphs so an OCR O/I/S read still matches a digit format', () => {
    // '0ISKJH' folds to '015KJH' → Utah ^\d{3}[A-Z]{3}$
    const r = formatScore('0ISKJH');
    expect(r.jurisdiction).toBe('UT');
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

describe('trustScore', () => {
  it('multi-frame agreement on a format-valid plate beats a lone model 100%', () => {
    const strong = trustScore({ reads: ['5KJH345', '5KJH345', '5KJH345'], modelPct: 0.6 });
    const lone = trustScore({ reads: ['5KJH345'], modelPct: 1.0 });
    expect(strong.trustScore).toBeGreaterThan(lone.trustScore);
  });
  it('caps a single read below the 0.85 assert gate no matter the model %', () => {
    const r = trustScore({ reads: ['5KJH345'], modelPct: 1.0 });
    expect(r.trustScore).toBeLessThan(0.85);
    expect(r.basis).toContain('single read');
  });
  it('surfaces the canonical plate and a human basis', () => {
    const r = trustScore({ reads: ['KJH345', 'KJH345'], modelPct: 0.8 });
    expect(r.canonical).toBe('KJH345');
    expect(typeof r.basis).toBe('string');
  });
  it('returns zero trust for no reads', () => {
    const r = trustScore({ reads: [] });
    expect(r.trustScore).toBe(0);
    expect(r.basis).toBe('no reads');
    expect(r.readCount).toBe(0);
  });
});
