import { describe, it, expect } from 'vitest';
import { parseSearchResponse, parseOffender, deriveTier } from '../src/utils/nsopw/parse';

const SAMPLE = {
  SearchResponse: {
    Offenders: [
      {
        OffenderDetails: {
          OffenderId: '12345',
          FirstName: 'John',
          MiddleName: 'A',
          LastName: 'Smith',
          DateOfBirth: '1985-06-12',
          Sex: 'M',
          Race: 'W',
          Address1: '123 Main St',
          City: 'Salt Lake City',
          State: 'UT',
          Zip: '84111',
          Offense: 'Sexual Battery',
          RiskLevel: 'Tier 3',
          Aliases: [
            { AliasName: 'Johnny Smith' },
            'J. Smith',
          ],
          ImageUrl: 'https://example.com/photo.jpg',
        },
        Provider: {
          ProviderName: 'UT',
          ProviderLabel: 'Utah Bureau of Criminal Identification',
        },
      },
    ],
    SearchResponseJurisdiction: [
      { Jurisdiction: 'UT', Status: 'ok' },
      { Jurisdiction: 'CA', Status: 'timeout' },
      { Jurisdiction: 'NV', Status: 'ok' },
    ],
  },
};

describe('NSOPW parseSearchResponse', () => {
  it('parses a documented-envelope response', () => {
    const r = parseSearchResponse(SAMPLE);
    expect(r.offenders).toHaveLength(1);
    const o = r.offenders[0];
    expect(o.firstName).toBe('John');
    expect(o.lastName).toBe('Smith');
    expect(o.middleName).toBe('A');
    expect(o.dateOfBirth).toBe('1985-06-12');
    expect(o.jurisdiction).toBe('UT');
    expect(o.tier).toBe(3);
    expect(o.aliases).toEqual(['Johnny Smith', 'J. Smith']);
  });

  it('captures jurisdiction coverage map', () => {
    const r = parseSearchResponse(SAMPLE);
    expect(r.jurisdictionCoverage['UT']).toBe('ok');
    expect(r.jurisdictionCoverage['CA']).toBe('timeout');
    expect(r.jurisdictionCoverage['NV']).toBe('ok');
  });

  it('tolerates lowercase/alt field names', () => {
    const alt = {
      offenders: [
        { offenderDetails: { firstName: 'A', lastName: 'B', dob: '1990-01-01' },
          provider: { providerName: 'NV' } },
      ],
    };
    const r = parseSearchResponse(alt);
    expect(r.offenders).toHaveLength(1);
    expect(r.offenders[0].firstName).toBe('A');
    expect(r.offenders[0].jurisdiction).toBe('NV');
  });

  it('drops rows with no name', () => {
    const empty = { offenders: [{ offenderDetails: {} }, { offenderDetails: { firstName: 'X' } }] };
    const r = parseSearchResponse(empty);
    expect(r.offenders).toHaveLength(1);
  });

  it('handles a completely garbage envelope', () => {
    expect(parseSearchResponse(null).offenders).toEqual([]);
    expect(parseSearchResponse(42).offenders).toEqual([]);
    expect(parseSearchResponse({ foo: 'bar' }).offenders).toEqual([]);
  });
});

describe('NSOPW parseOffender', () => {
  it('returns null for non-object input', () => {
    expect(parseOffender(null)).toBeNull();
    expect(parseOffender('string')).toBeNull();
  });

  it('uppercases jurisdiction code', () => {
    const o = parseOffender({
      offenderDetails: { firstName: 'A', lastName: 'B' },
      provider: { providerName: 'ut' },
    });
    expect(o?.jurisdiction).toBe('UT');
  });
});

describe('deriveTier', () => {
  it('maps tier labels to integers', () => {
    expect(deriveTier('Tier 3')).toBe(3);
    expect(deriveTier('Tier III')).toBe(3);
    expect(deriveTier('Level 2')).toBe(2);
    expect(deriveTier('Tier 1')).toBe(1);
    expect(deriveTier('SVP')).toBe(3);
    expect(deriveTier('Sexually Violent Predator')).toBe(3);
    expect(deriveTier('High')).toBe(3);
    expect(deriveTier('Moderate')).toBe(2);
    expect(deriveTier('Low')).toBe(1);
  });

  it('returns null for unknown labels', () => {
    expect(deriveTier(null)).toBeNull();
    expect(deriveTier('Unspecified')).toBeNull();
    expect(deriveTier('')).toBeNull();
  });
});
