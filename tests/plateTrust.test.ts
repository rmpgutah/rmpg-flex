import { describe, it, expect } from 'vitest';
import { normalizePlate } from '../src/utils/plateTrust';

describe('normalizePlate', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(normalizePlate(' kjh-345 ')).toBe('KJH345');
  });
  it('maps ambiguous glyphs to a canonical form for comparison', () => {
    expect(normalizePlate('OISBZ')).toBe('01582');
  });
});
