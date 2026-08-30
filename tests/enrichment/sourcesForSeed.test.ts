import { describe, it, expect } from 'vitest';
import { OPEN_SOURCE_ENRICHMENT_SOURCES } from '../../src/utils/enrichment/catalog';
import { sourcesForSeed } from '../../src/utils/enrichment/runSearch';
import type { EnrichmentSeed } from '../../src/utils/enrichment/types';

const keys = (seed: EnrichmentSeed) => sourcesForSeed(OPEN_SOURCE_ENRICHMENT_SOURCES, seed).map(s => s.key);

describe('sourcesForSeed', () => {
  it('keeps name-based people sources when first+last are present', () => {
    const k = keys({ first_name: 'Jane', last_name: 'Doe' });
    expect(k).toContain('fbi_wanted');
    expect(k).toContain('courtlistener');
    expect(k).toContain('apollo');
    expect(k).toContain('pdl');
    expect(k).toContain('usa_people_search');
    expect(k).not.toContain('numverify');
    expect(k).not.toContain('hibp');
    expect(k).not.toContain('hunter');
    expect(k).not.toContain('usps');
  });

  it('runs reverse-phone sources without a name', () => {
    const k = keys({ first_name: '', last_name: '', phone: '8015550100' });
    expect(k.sort()).toEqual(['numverify', 'pdl', 'usa_people_search'].sort());
  });

  it('runs reverse-email sources without a name', () => {
    const k = keys({ first_name: '', last_name: '', email: 'jane@example.com' });
    expect(k.sort()).toEqual(['hibp', 'hunter', 'pdl', 'usa_people_search'].sort());
  });

  it('keeps address-only sources for address seeds', () => {
    const k = keys({ first_name: '', last_name: '', address: '123 Main St' });
    expect(k.sort()).toEqual(['census_geocoder', 'sl_assessor', 'usps'].sort());
  });
});
