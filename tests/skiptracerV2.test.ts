import { describe, it, expect } from 'vitest';
import {
  personRowToProfile,
  enrichedRecordToProfile,
  parseSearchParams,
  buildEnrichmentSeed,
  parseVehicleQuery,
  detectSearchTypeFromParams,
  historyQueryFromParams,
} from '../src/utils/skiptracerV2/search';

describe('skiptracerV2 search helpers', () => {
  it('maps a local person row to a V2 profile', () => {
    const profile = personRowToProfile({
      id: 42,
      first_name: 'Jane',
      middle_name: 'Q',
      last_name: 'Public',
      dob: '1990-05-12',
      phone: '8015550100',
      email: 'jane@example.com',
      address: '123 Main St',
      city: 'Salt Lake City',
      state: 'UT',
      zip: '84101',
      ssn_last4: null,
      ssn_full: '123456789',
    });
    expect(profile.id).toBe('LOCAL-42');
    expect(profile.fullName).toBe('Jane Q Public');
    expect(profile.ssn_last4).toBe('6789');
    expect(profile.sources).toContain('local_rms');
    expect(profile.phones?.[0]?.number).toBe('8015550100');
  });

  it('parses search params from a URL query string', () => {
    const params = parseSearchParams(new URLSearchParams(
      'q=John+Smith&engine=all&categories=people,registry&firstName=John&lastName=Smith',
    ));
    expect(params.q).toBe('John Smith');
    expect(params.engine).toBe('all');
    expect(params.categories).toEqual(['people', 'registry']);
    expect(params.firstName).toBe('John');
    expect(params.lastName).toBe('Smith');
  });

  it('defaults engine to all when not specified', () => {
    const params = parseSearchParams(new URLSearchParams('q=John+Smith'));
    expect(params.engine).toBe('all');
  });

  it('parses plate and VIN queries', () => {
    expect(parseVehicleQuery('UT ABC123')).toEqual({ state: 'UT', plate: 'ABC123' });
    expect(parseVehicleQuery('1HGCM82633A004352')).toEqual({ vin: '1HGCM82633A004352' });
    expect(parseVehicleQuery('ABC123', 'UT')).toEqual({ plate: 'ABC123', state: 'UT' });
  });

  it('does not treat person names as vehicle plates', () => {
    expect(parseVehicleQuery('Jane Doe')).toEqual({});
    expect(detectSearchTypeFromParams(parseSearchParams(new URLSearchParams('q=Jane+Doe')))).toBe('name');
  });

  it('detects vehicle and address search types', () => {
    expect(detectSearchTypeFromParams(parseSearchParams(new URLSearchParams('q=UT+ABC123')))).toBe('vehicle');
    expect(detectSearchTypeFromParams(parseSearchParams(new URLSearchParams('q=123+Main+St+Salt+Lake+City')))).toBe('address');
  });

  it('builds an enrichment seed for address searches', () => {
    const seed = buildEnrichmentSeed(parseSearchParams(new URLSearchParams('q=123+Main+St')));
    expect(seed?.address).toBe('123 Main St');
    expect(seed?.first_name).toBe('');
    expect(seed?.last_name).toBe('');
  });

  it('reconstructs history query from stored params', () => {
    expect(historyQueryFromParams({ q: 'Karl Allen Turley', firstName: 'Karl', lastName: 'Turley' }))
      .toBe('Karl Allen Turley');
    expect(historyQueryFromParams({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
  });

  it('maps three-part names in enrichment records', () => {
    const profile = enrichedRecordToProfile({
      name: 'Karl Allen Turley',
      addresses: [], phones: [], emails: [], source: 'fbi_wanted',
    }, 'fbi_wanted', 'UNCONFIRMED');
    expect(profile.firstName).toBe('Karl');
    expect(profile.lastName).toBe('Turley');
  });

  it('builds an enrichment seed from name query params', () => {
    const seed = buildEnrichmentSeed(parseSearchParams(new URLSearchParams('q=John+Smith&dob=1990-05-12')));
    expect(seed).toEqual({
      first_name: 'John',
      last_name: 'Smith',
      dob: '1990-05-12',
      city: undefined,
      state: undefined,
      phone: undefined,
      email: undefined,
      address: undefined,
      ssn_last4: undefined,
    });
  });

  it('maps enrichment records into dossier profiles', () => {
    const profile = enrichedRecordToProfile({
      name: 'John Smith',
      dob: '1990-05-12',
      addresses: [{ street: '1 Main', city: 'SLC', state: 'UT', source: 'nsopw' }],
      phones: ['8015550100'],
      emails: ['john@example.com'],
      watchlist_flags: ['OFAC'],
      source: 'nsopw',
    }, 'nsopw', 'CONFIRMED');
    expect(profile.fullName).toBe('John Smith');
    expect(profile.sources).toEqual(['nsopw']);
    expect(profile.watchlistFlags?.[0]?.listName).toBe('OFAC');
  });
});
