import { describe, it, expect } from 'vitest';
import { findDisallowedHex, ALLOWED_HEX } from '../scripts/theme-hex-audit.mjs';

describe('findDisallowedHex', () => {
  it('flags raw 6-digit hex', () => {
    expect(findDisallowedHex('color: #1a2b3c; background: #ffffff')).toEqual(['#1a2b3c', '#ffffff']);
  });
  it('allows brand gold #d4a017 (case-insensitive)', () => {
    expect(findDisallowedHex('color: #d4a017')).toEqual([]);
    expect(findDisallowedHex('color: #D4A017')).toEqual([]);
  });
  it('returns empty for token-only text', () => {
    expect(findDisallowedHex('color: var(--spm-text); background: var(--surface-base)')).toEqual([]);
  });
  it('exposes brand gold in the allow-set', () => {
    expect(ALLOWED_HEX.has('#d4a017')).toBe(true);
  });
});
