import { describe, it, expect } from 'vitest';
import { normalizeName, toCanonicalName, normalizeDob, syntheticWarrantId } from '../normalize';

describe('normalizeName', () => {
  it('uppercases and collapses whitespace', () => {
    expect(normalizeName('  John   Q.  Public ')).toBe('JOHN Q PUBLIC');
  });

  it('strips non-word punctuation except comma/hyphen', () => {
    expect(normalizeName("O'Brien-Smith, John!")).toBe('OBRIEN-SMITH, JOHN');
  });

  it('handles already-canonical input idempotently', () => {
    const once = normalizeName('SMITH, JOHN');
    expect(normalizeName(once)).toBe(once);
  });
});

describe('toCanonicalName', () => {
  it('converts "First Last" to "LAST, FIRST"', () => {
    expect(toCanonicalName('John Smith')).toBe('SMITH, JOHN');
  });

  it('preserves middle name in canonical form', () => {
    expect(toCanonicalName('John Quincy Adams')).toBe('ADAMS, JOHN QUINCY');
  });

  it('is idempotent on already-canonical input', () => {
    expect(toCanonicalName('SMITH, JOHN')).toBe('SMITH, JOHN');
  });

  it('returns single token unchanged (mononym)', () => {
    expect(toCanonicalName('Cher')).toBe('CHER');
  });
});

describe('normalizeDob', () => {
  it('passes through ISO YYYY-MM-DD', () => {
    expect(normalizeDob('1985-03-14')).toBe('1985-03-14');
  });

  it('converts MM/DD/YYYY', () => {
    expect(normalizeDob('3/14/1985')).toBe('1985-03-14');
  });

  it('expands 2-digit year > 30 to 19xx', () => {
    expect(normalizeDob('3/14/85')).toBe('1985-03-14');
  });

  it('expands 2-digit year <= 30 to 20xx', () => {
    expect(normalizeDob('3/14/05')).toBe('2005-03-14');
  });

  it('zero-pads single-digit month/day', () => {
    expect(normalizeDob('1/2/1990')).toBe('1990-01-02');
  });

  it('returns undefined for unparseable input', () => {
    expect(normalizeDob('not a date')).toBeUndefined();
    expect(normalizeDob('')).toBeUndefined();
    expect(normalizeDob(undefined)).toBeUndefined();
  });
});

describe('syntheticWarrantId', () => {
  it('is stable across calls with same input', () => {
    const a = syntheticWarrantId({ name: 'John Smith', dob: '1985-03-14', charges: ['THEFT'] });
    const b = syntheticWarrantId({ name: 'John Smith', dob: '1985-03-14', charges: ['THEFT'] });
    expect(a).toBe(b);
  });

  it('is stable regardless of charge order', () => {
    const a = syntheticWarrantId({ name: 'X', charges: ['A', 'B'] });
    const b = syntheticWarrantId({ name: 'X', charges: ['B', 'A'] });
    expect(a).toBe(b);
  });

  it('produces different IDs for different people', () => {
    const a = syntheticWarrantId({ name: 'John Smith', charges: ['THEFT'] });
    const b = syntheticWarrantId({ name: 'Jane Doe', charges: ['THEFT'] });
    expect(a).not.toBe(b);
  });

  it('produces different IDs when same person has different charges', () => {
    const a = syntheticWarrantId({ name: 'X', charges: ['THEFT'] });
    const b = syntheticWarrantId({ name: 'X', charges: ['ASSAULT'] });
    expect(a).not.toBe(b);
  });

  it('starts with "syn_" prefix to distinguish from real source IDs', () => {
    expect(syntheticWarrantId({ name: 'X', charges: [] })).toMatch(/^syn_[0-9a-f]+$/);
  });
});
