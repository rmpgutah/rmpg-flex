import { describe, it, expect } from 'vitest';
import {
  buildUsaPeopleSearchUrl,
  mapUsaPeopleRecords,
} from '../../src/utils/enrichment/sources/usaPeopleSearch';
import { stringContactValues, mapPdlPerson } from '../../src/utils/enrichment/sources/pdl';
import { domainFromEmail, hunterFinderUrl, hunterVerifierUrl } from '../../src/utils/enrichment/sources/hunter';
import { apolloSearchBody, mapApolloPeople } from '../../src/utils/enrichment/sources/apollo';
import { hibpBreachedAccountUrl, mapHibpBreaches } from '../../src/utils/enrichment/sources/hibp';
import { mapCourtRecords } from '../../src/utils/enrichment/sources/courtlistener';

describe('USA People Search mapper', () => {
  it('builds name vs reverse-phone URLs', () => {
    const nameUrl = buildUsaPeopleSearchUrl({ first_name: 'Jane', last_name: 'Doe', city: 'Dallas', state: 'TX' });
    expect(nameUrl).toContain('/search?');
    expect(nameUrl).toContain('name=Jane+Doe');
    expect(nameUrl).toContain('city=Dallas');
    const phoneUrl = buildUsaPeopleSearchUrl({ first_name: '', last_name: '', phone: '(214) 349-3972' });
    expect(phoneUrl).toContain('phone=2143493972');
  });

  it('maps TruePeopleSearch-shaped records', () => {
    const recs = mapUsaPeopleRecords({
      results: [{
        'First Name': 'Jane',
        'Last Name': 'Doe',
        'Street Address': '1 Main',
        city: 'Dallas',
        state: 'TX',
        phones: ['2145550100'],
        emails: ['jane@example.com'],
      }],
    });
    expect(recs).toHaveLength(1);
    expect(recs[0].name).toBe('Jane Doe');
    expect(recs[0].phones).toEqual(['2145550100']);
    expect(recs[0].emails).toEqual(['jane@example.com']);
    expect(recs[0].addresses[0]?.street).toBe('1 Main');
  });
});

describe('PDL free-plan contact fields', () => {
  it('drops boolean contact placeholders', () => {
    expect(stringContactValues([true, false, '2145550100'])).toEqual(['2145550100']);
    expect(stringContactValues([{ address: 'a@b.com' }, { address: true }])).toEqual(['a@b.com']);
  });

  it('maps a PDL person with location and job', () => {
    const rec = mapPdlPerson({
      full_name: 'Jane Doe',
      emails: [true],
      phone_numbers: [false],
      location_name: 'Dallas, Texas',
      job_title: 'Analyst',
      job_company_name: 'Acme',
    });
    expect(rec?.name).toBe('Jane Doe');
    expect(rec?.emails).toEqual([]);
    expect(rec?.phones).toEqual([]);
    expect(rec?.addresses[0]?.city).toBe('Dallas, Texas');
    expect(rec?.business_associations).toEqual(['Analyst', 'Acme']);
  });
});

describe('Hunter URL builders', () => {
  it('extracts domain and builds verifier/finder URLs', () => {
    expect(domainFromEmail('jane@example.com')).toBe('example.com');
    expect(hunterVerifierUrl('jane@example.com', 'k')).toContain('email=jane%40example.com');
    expect(hunterFinderUrl('Jane', 'Doe', 'example.com', 'k')).toContain('domain=example.com');
  });
});

describe('Apollo people search', () => {
  it('builds a 0-credit search body and maps people without contact fields', () => {
    const body = apolloSearchBody({ first_name: 'Jane', last_name: 'Doe', city: 'SLC', state: 'UT' });
    expect(body.q_person_name).toBe('Jane Doe');
    expect(body.person_locations).toEqual(['SLC, UT']);
    const recs = mapApolloPeople([{
      name: 'Jane Doe',
      title: 'Dispatcher',
      organization_name: 'RMPG',
      city: 'Salt Lake City',
      state: 'UT',
    }]);
    expect(recs[0].emails).toEqual([]);
    expect(recs[0].phones).toEqual([]);
    expect(recs[0].business_associations).toEqual(['Dispatcher', 'RMPG']);
  });
});

describe('HIBP + CourtListener mappers', () => {
  it('maps truncated HIBP breaches', () => {
    expect(hibpBreachedAccountUrl('a@b.com')).toContain('breachedaccount/a%40b.com');
    const recs = mapHibpBreaches('a@b.com', [{ Name: 'Adobe' }, { Name: 'LinkedIn' }]);
    expect(recs[0].watchlist_flags).toEqual(['hibp:Adobe', 'hibp:LinkedIn']);
    expect(recs[0].emails).toEqual(['a@b.com']);
  });

  it('flags federal criminal captions', () => {
    const recs = mapCourtRecords('Jane Doe', [{
      case_name: 'United States v. Doe',
      docket_number: '1:20-cr-1',
      court: 'dcd',
      date_filed: '2020-01-01',
      url: 'https://www.courtlistener.com/docket/1/',
      is_criminal: true,
    }]);
    expect(recs[0].watchlist_flags).toContain('federal_criminal_docket');
    expect(recs[0].business_associations).toEqual(['United States v. Doe']);
  });
});
