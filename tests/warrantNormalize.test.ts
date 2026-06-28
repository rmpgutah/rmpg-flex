import { describe, it, expect } from 'vitest';
import { cleanName, normalizeDate, normalizeBond, displayName } from '../src/utils/warrantSources/normalize';

describe('cleanName', () => {
  it('trims, collapses whitespace, title-cases an all-caps name', () => {
    expect(cleanName('  SMITH,   JOHN  Q ')).toBe('Smith, John Q');
  });
  it('returns empty for nullish', () => { expect(cleanName(null)).toBe(''); expect(cleanName(undefined)).toBe(''); });
});

describe('normalizeDate', () => {
  it('passes through an ISO date', () => { expect(normalizeDate('1985-04-12')).toBe('1985-04-12'); });
  it('converts epoch-millis (ArcGIS) to ISO date', () => { expect(normalizeDate(482112000000)).toBe('1985-04-12'); });
  it('parses M/D/YYYY', () => { expect(normalizeDate('4/12/1985')).toBe('1985-04-12'); });
  it('returns null for junk', () => { expect(normalizeDate('unknown')).toBeNull(); expect(normalizeDate(null)).toBeNull(); });
});

describe('normalizeBond', () => {
  it('parses a dollar string to a number', () => { expect(normalizeBond('$1,500.00')).toBe(1500); });
  it('returns null for non-numeric (PR / No Bond)', () => { expect(normalizeBond('PR')).toBeNull(); expect(normalizeBond('No Bond')).toBeNull(); });
  it('passes a number through', () => { expect(normalizeBond(750)).toBe(750); });
});

describe('displayName', () => {
  it('builds Last, First M from parts', () => {
    expect(displayName({ first_name: 'John', middle_name: 'Q', last_name: 'Smith' })).toBe('Smith, John Q');
  });
  it('falls back to full_name when parts missing', () => {
    expect(displayName({ full_name: 'JANE DOE' })).toBe('Jane Doe');
  });
});
