import { describe, it, expect } from 'vitest';
import { shortLabel, coordLabel } from '../navLabel';

describe('navLabel — shortLabel', () => {
  it('takes the first non-blank line', () => {
    expect(shortLabel('123 S Main St\nSalt Lake City, UT')).toBe('123 S Main St');
    expect(shortLabel('\n\n  456 W Center  \nProvo')).toBe('456 W Center');
  });
  it('returns empty for sentinel / blank values', () => {
    expect(shortLabel('None')).toBe('');
    expect(shortLabel('N/A')).toBe('');
    expect(shortLabel('0')).toBe('');
    expect(shortLabel('  ')).toBe('');
    expect(shortLabel(null)).toBe('');
    expect(shortLabel(undefined)).toBe('');
  });
  it('collapses whitespace', () => {
    expect(shortLabel('123    S     Main')).toBe('123 S Main');
  });
  it('truncates with ellipsis past maxLen', () => {
    const long = 'A'.repeat(60);
    const out = shortLabel(long, 48);
    expect(out.length).toBe(48);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('navLabel — coordLabel', () => {
  it('4-decimal canonical form', () => {
    expect(coordLabel(40.76083, -111.89105)).toBe('40.7608, -111.8911'); // (-111.89105).toFixed(4) === '-111.8911'
  });
  it('empty for invalid coords', () => {
    expect(coordLabel(NaN, 0)).toBe('');
    expect(coordLabel(0, Infinity)).toBe('');
  });
});
