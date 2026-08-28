import { describe, it, expect } from 'vitest';
import {
  personRowToProfile,
  enrichedRecordToProfile,
  parseSearchParams,
  buildEnrichmentSeed,
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
    }, 'nsopw');
    expect(profile.fullName).toBe('John Smith');
    expect(profile.sources).toEqual(['nsopw']);
    expect(profile.watchlistFlags?.[0]?.listName).toBe('OFAC');
  });
});
