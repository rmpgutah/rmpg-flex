import { describe, expect, it } from 'vitest';
import { hashToHsl } from '../colorLookup';

describe('hashToHsl', () => {
  it('is deterministic for the same input', () => {
    expect(hashToHsl('SL1')).toBe(hashToHsl('SL1'));
    expect(hashToHsl('UTC1')).toBe(hashToHsl('UTC1'));
  });

  it('returns a syntactically valid HSL string', () => {
    expect(hashToHsl('SL1')).toMatch(/^hsl\(\d+(?:\.\d+)?, \d+%, \d+%\)$/);
  });

  it('sequential same-prefix codes (SL1/SL2/SL3) all produce distinct hues', () => {
    const hues = ['SL1', 'SL2', 'SL3', 'UT1', 'UT2', 'UT3'].map((c) => {
      const m = hashToHsl(c).match(/^hsl\((\d+(?:\.\d+)?)/);
      return Number(m![1]);
    });
    expect(new Set(hues).size).toBe(hues.length);
  });
});
