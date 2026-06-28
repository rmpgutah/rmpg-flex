import { describe, it, expect } from 'vitest';
import { canonName, canonDob, cacheKeyOf, foldName } from '../src/utils/nsopw/normalize';

describe('NSOPW normalize.foldName', () => {
  it('lowercases, strips diacritics, collapses punctuation', () => {
    expect(foldName("O'Brien-Jones")).toBe('o brien jones');
    expect(foldName('Renée  Müller')).toBe('renee muller');
    expect(foldName('   ')).toBe('');
    expect(foldName(null)).toBe('');
  });
});

describe('NSOPW normalize.canonName', () => {
  it('drops suffixes', () => {
    expect(canonName('Robert Smith Jr.')).toBe('robert smith');
    expect(canonName('John Smith III')).toBe('john smith');
    expect(canonName('Jane Doe Sr')).toBe('jane doe');
  });

  it('drops honorifics', () => {
    expect(canonName('Dr. John A. Smith')).toBe('john a smith');
    expect(canonName('Mr. Smith')).toBe('smith');
  });

  it('idempotent', () => {
    expect(canonName(canonName('Mr. Robert Smith Jr.'))).toBe('robert smith');
  });

  it('treats hyphens like spaces — same canonical', () => {
    expect(canonName('Mary-Jane Watson')).toBe(canonName('Mary Jane Watson'));
  });
});

describe('NSOPW normalize.canonDob', () => {
  it('parses ISO formats', () => {
    expect(canonDob('1985-06-12')).toBe('1985-06-12');
    expect(canonDob('1985/06/12')).toBe('1985-06-12');
    expect(canonDob('1985-6-12')).toBe('1985-06-12');
    expect(canonDob('1985-06-12T00:00:00Z')).toBe('1985-06-12');
  });

  it('parses US-format', () => {
    expect(canonDob('06/12/1985')).toBe('1985-06-12');
    expect(canonDob('6-12-1985')).toBe('1985-06-12');
  });

  it('disambiguates 2-digit year toward old enough to be an adult', () => {
    // todayYear=2026 → 26+18=44; "85" = (2085) makes person -59, so use 1985.
    expect(canonDob('6/12/85', 2026)).toBe('1985-06-12');
    // "10" with todayYear=2026 → 2010 would be 16 (juvenile) → fall to 1910
    expect(canonDob('1/2/10', 2026)).toBe('1910-01-02');
  });

  it('returns empty on garbage', () => {
    expect(canonDob('not a date')).toBe('');
    expect(canonDob('')).toBe('');
    expect(canonDob(null)).toBe('');
    expect(canonDob('99/99/9999')).toBe('');
  });
});

describe('NSOPW normalize.cacheKeyOf', () => {
  it('collapses equivalent queries to the same key', () => {
    const a = cacheKeyOf({ surname: 'Smith', forename: 'John', dob: '1985-06-12' });
    const b = cacheKeyOf({ surname: 'SMITH', forename: 'john', dob: '06/12/1985' });
    const c = cacheKeyOf({ surname: '  Smith Jr ', forename: 'John A.', dob: '1985-6-12' });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('different DOB → different key', () => {
    const a = cacheKeyOf({ surname: 'Smith', forename: 'John', dob: '1985-06-12' });
    const b = cacheKeyOf({ surname: 'Smith', forename: 'John', dob: '1985-06-13' });
    expect(a).not.toBe(b);
  });

  it('absent DOB is its own bucket', () => {
    const a = cacheKeyOf({ surname: 'Smith', forename: 'John' });
    const b = cacheKeyOf({ surname: 'Smith', forename: 'John', dob: '1985-06-12' });
    expect(a).not.toBe(b);
  });
});
