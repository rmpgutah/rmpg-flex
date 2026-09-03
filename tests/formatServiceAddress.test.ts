import { describe, it, expect } from 'vitest';
import { formatServiceAddress, flattenServiceAddress } from '../src/utils/formatServiceAddress';

describe('formatServiceAddress', () => {
  it('renders street / city-state-zip / county-country', () => {
    expect(formatServiceAddress({
      address: '123 Apple Cherry Lane',
      city: 'South Bend',
      state: 'UT',
      zip: '84950',
      county: 'King',
    })).toBe('123 Apple Cherry Lane\nSouth Bend, UT 84950\nKing County, USA');
  });

  it('parses a jammed one-liner', () => {
    expect(formatServiceAddress({
      address: '5264 SOUTH ROME BEAUTY PARK, MURRAY, UT 84123',
    })).toBe('5264 South Rome Beauty Park\nMurray, UT 84123\nUSA');
  });

  it('handles the extra comma between state and ZIP', () => {
    expect(formatServiceAddress({
      address: '1240 East 2100 South, Salt Lake City, UT, 84106',
    })).toBe('1240 East 2100 South\nSalt Lake City, UT 84106\nUSA');
  });

  it('is idempotent', () => {
    const once = formatServiceAddress({
      address: '123 Apple Cherry Lane, South Bend, Ampsterdam 84950, King County, USA',
    });
    expect(once).toBe('123 Apple Cherry Lane\nSouth Bend, Ampsterdam 84950\nKing County, USA');
    expect(formatServiceAddress({ address: once })).toBe(once);
  });

  it('flattens a block for a sentence without a state-ZIP comma', () => {
    expect(flattenServiceAddress('1240 East 2100 South\nSalt Lake City, UT 84106\nUSA'))
      .toBe('1240 East 2100 South, Salt Lake City, UT 84106, USA');
  });
});
