import type { EnrichmentSeed, SourceResult } from './types';
import type { Bindings } from '../../types';
import * as nsopwSrc from './sources/nsopw';
import * as assessorSrc from './sources/assessor';
import * as openSanctionsSrc from './sources/openSanctions';
import * as fbiSrc from './sources/fbi';
import * as bopSrc from './sources/bop';
import * as censusGeoSrc from './sources/censusGeocoder';
import * as ofacSrc from './sources/ofac';
import * as uspsSrc from './sources/usps';
import * as openCorporatesSrc from './sources/openCorporates';
import * as numverifySrc from './sources/numverify';
import * as usaPeopleSearchSrc from './sources/usaPeopleSearch';
import * as hunterSrc from './sources/hunter';
import * as pdlSrc from './sources/pdl';
import * as apolloSrc from './sources/apollo';
import * as hibpSrc from './sources/hibp';
import * as courtlistenerSrc from './sources/courtlistener';

export interface EnrichmentSourceDefinition {
  key: string;
  label: string;
  category: 'registry' | 'property' | 'business' | 'osint' | 'people';
  /** True when the adapter needs no API key or paid account. */
  openSource: boolean;
  mod: { search: (seed: EnrichmentSeed, env: Bindings) => Promise<SourceResult> };
}

/** Adapters that require no API key — the Skip Trace open-source stack. */
export const OPEN_SOURCE_ENRICHMENT_SOURCES: EnrichmentSourceDefinition[] = [
  { key: 'nsopw',           label: 'NSOPW',              category: 'registry', openSource: true,  mod: nsopwSrc },
  { key: 'sl_assessor',     label: 'SL County Assessor', category: 'property', openSource: true,  mod: assessorSrc },
  { key: 'open_sanctions',  label: 'OpenSanctions',      category: 'registry', openSource: true,  mod: openSanctionsSrc },
  { key: 'fbi_wanted',      label: 'FBI Most Wanted',    category: 'registry', openSource: true,  mod: fbiSrc },
  { key: 'bop_inmates',     label: 'BOP Inmate Locator', category: 'registry', openSource: true,  mod: bopSrc },
  { key: 'census_geocoder', label: 'Census Geocoder',    category: 'property', openSource: true,  mod: censusGeoSrc },
  { key: 'ofac_sdn',        label: 'OFAC SDN',           category: 'registry', openSource: true,  mod: ofacSrc },
  { key: 'usps',            label: 'USPS Address',       category: 'property', openSource: false, mod: uspsSrc },
  { key: 'open_corporates', label: 'OpenCorporates',     category: 'business', openSource: false, mod: openCorporatesSrc },
  { key: 'numverify',          label: 'NumVerify',                    category: 'osint',    openSource: false, mod: numverifySrc },
  { key: 'usa_people_search',  label: 'USA People Search (RapidAPI)',  category: 'people',   openSource: false, mod: usaPeopleSearchSrc },
  { key: 'hunter',             label: 'Hunter.io',                    category: 'people',   openSource: false, mod: hunterSrc },
  { key: 'pdl',               label: 'People Data Labs',            category: 'people',   openSource: false, mod: pdlSrc },
  { key: 'apollo',             label: 'Apollo People Search',         category: 'people',   openSource: false, mod: apolloSrc },
  { key: 'hibp',               label: 'Have I Been Pwned',          category: 'osint',    openSource: false, mod: hibpSrc },
  { key: 'courtlistener',      label: 'CourtListener',                 category: 'registry', openSource: true,  mod: courtlistenerSrc },
];

export const ENRICHMENT_SOURCE_CATEGORIES: Record<string, EnrichmentSourceDefinition['category']> =
  Object.fromEntries(OPEN_SOURCE_ENRICHMENT_SOURCES.map(s => [s.key, s.category]));
