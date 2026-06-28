import { describe, it, expect } from 'vitest';
import { composeAddressUnit } from '../addressUnit';

describe('composeAddressUnit', () => {
  it('appends a bare unit with an Apt label', () => {
    expect(composeAddressUnit('123 Main St', '4B')).toBe('123 Main St, Apt 4B');
  });

  it('keeps an explicit designator verbatim', () => {
    expect(composeAddressUnit('123 Main St', 'Unit 12')).toBe('123 Main St, Unit 12');
    expect(composeAddressUnit('123 Main St', '#305')).toBe('123 Main St, #305');
    expect(composeAddressUnit('123 Main St', 'Ste 200')).toBe('123 Main St, Ste 200');
  });

  it('returns the address unchanged with no unit', () => {
    expect(composeAddressUnit('123 Main St', '')).toBe('123 Main St');
    expect(composeAddressUnit('123 Main St', '   ')).toBe('123 Main St');
  });

  it('ignores a unit with no address', () => {
    expect(composeAddressUnit('', '4B')).toBe('');
  });

  it('does not double-append when the address already contains the unit', () => {
    expect(composeAddressUnit('123 Main St, Apt 4B', '4B')).toBe('123 Main St, Apt 4B');
    expect(composeAddressUnit('123 Main St Unit 12', 'Unit 12')).toBe('123 Main St Unit 12');
  });

  it('trims input', () => {
    expect(composeAddressUnit(' 123 Main St ', ' 4B ')).toBe('123 Main St, Apt 4B');
  });
});
