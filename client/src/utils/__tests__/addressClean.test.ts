import { describe, it, expect } from 'vitest';
import { cleanAddressText } from '../addressClean';

describe('cleanAddressText', () => {
  it('strips an unbalanced trailing ")" (the Mapbox place_name defect)', () => {
    expect(cleanAddressText('4501 SOUTH CONSTITUTION BLVD, TAYLORSVILLE, UTAH 84129, UNITED STATES)'))
      .toBe('4501 SOUTH CONSTITUTION BLVD, TAYLORSVILLE, UTAH 84129, UNITED STATES');
  });

  it('strips a dangling trailing comma', () => {
    expect(cleanAddressText('4501 SOUTH CONSTITUTION BOULEVARD,')).toBe('4501 SOUTH CONSTITUTION BOULEVARD');
  });

  it('strips combined trailing junk ")," in any order', () => {
    expect(cleanAddressText('123 Main St, USA),')).toBe('123 Main St, USA');
    expect(cleanAddressText('123 Main St )  ;')).toBe('123 Main St');
  });

  it('PRESERVES balanced parentheses (legitimate parentheticals)', () => {
    expect(cleanAddressText('100 Center St, Bldg A (rear entrance)')).toBe('100 Center St, Bldg A (rear entrance)');
  });

  it('collapses internal whitespace and trims', () => {
    expect(cleanAddressText('  742   Evergreen   Terrace  ')).toBe('742 Evergreen Terrace');
  });

  it('returns empty string for nullish/empty input', () => {
    expect(cleanAddressText(null)).toBe('');
    expect(cleanAddressText(undefined)).toBe('');
    expect(cleanAddressText('')).toBe('');
  });

  it('is idempotent', () => {
    const once = cleanAddressText('500 W Temple, SLC, UT 84101, USA)');
    expect(cleanAddressText(once)).toBe(once);
  });

  it('leaves a clean address unchanged', () => {
    expect(cleanAddressText('200 E 100 S, Salt Lake City, UT 84111')).toBe('200 E 100 S, Salt Lake City, UT 84111');
  });
});
