// ============================================================
// Skip Tracker 3.5 — ProgrammableWeb API Directory Source
// ============================================================
// Curated directory of public APIs useful for skip tracing,
// sourced from GunioRobot/hack-boston API catalog.
// Provides reference links and supplemental lookup endpoints
// for investigators — no API key required.
// Categories: Government, Financial, Real Estate, Social,
// People Search, Phone Lookup, Address Verification.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult } from '../types';
import { localNow } from '../../../utils/timeUtils';

// ============================================================
// Curated API Directory — Skip-Trace Relevant Sources
// ============================================================
// Extracted from ProgrammableWeb/hack-boston items.json and
// augmented with modern skip-trace-relevant public APIs.

interface ApiDirectoryEntry {
  name: string;
  category: string;
  protocol: string;
  description: string;
  url: string;
  searchTypes: ('name' | 'phone' | 'email' | 'address' | 'business' | 'property' | 'all')[];
  free: boolean;
}

const API_DIRECTORY: ApiDirectoryEntry[] = [
  // ── Government / Public Records ──
  {
    name: 'FBI Most Wanted API',
    category: 'Government',
    protocol: 'REST',
    description: 'FBI public most wanted persons database — search by name, aliases',
    url: 'https://api.fbi.gov/@wanted',
    searchTypes: ['name'],
    free: true,
  },
  {
    name: 'US Marshals Fugitive List',
    category: 'Government',
    protocol: 'REST',
    description: 'US Marshals Service 15 Most Wanted fugitives',
    url: 'https://www.usmarshals.gov/investigations/most_wanted',
    searchTypes: ['name'],
    free: true,
  },
  {
    name: 'DEA Fugitives',
    category: 'Government',
    protocol: 'REST',
    description: 'DEA most wanted fugitives list — drug-related offenses',
    url: 'https://www.dea.gov/fugitives',
    searchTypes: ['name'],
    free: true,
  },
  {
    name: 'OFAC SDN List',
    category: 'Government',
    protocol: 'REST',
    description: 'Treasury OFAC sanctions list — Specially Designated Nationals',
    url: 'https://sanctionslist.ofac.treas.gov/',
    searchTypes: ['name'],
    free: true,
  },
  {
    name: 'NSOPW Sex Offender Registry',
    category: 'Government',
    protocol: 'REST',
    description: 'National Sex Offender Public Website — all 50 states',
    url: 'https://www.nsopw.gov/en/Search/Verification',
    searchTypes: ['name', 'address'],
    free: true,
  },
  {
    name: 'FCC ULS License Search',
    category: 'Government',
    protocol: 'REST',
    description: 'FCC Universal Licensing System — radio/broadcast licenses by name',
    url: 'https://wireless2.fcc.gov/UlsApp/UlsSearch/searchLicense.jsp',
    searchTypes: ['name'],
    free: true,
  },
  {
    name: 'Utah Courts Xchange',
    category: 'Government',
    protocol: 'REST',
    description: 'Utah state court case search — criminal, civil, traffic, family',
    url: 'https://www.utcourts.gov/xchange/',
    searchTypes: ['name'],
    free: true,
  },
  {
    name: 'PACER Federal Courts',
    category: 'Government',
    protocol: 'REST',
    description: 'Federal court records — bankruptcy, civil, criminal, appellate',
    url: 'https://pcl.uscourts.gov/pcl/index.jsf',
    searchTypes: ['name'],
    free: false,
  },
  {
    name: 'Utah DOPL License Verification',
    category: 'Government',
    protocol: 'REST',
    description: 'Utah professional/occupational license lookup — verify credentials',
    url: 'https://secure.utah.gov/llv/search/index.html',
    searchTypes: ['name'],
    free: true,
  },
  {
    name: 'Utah Business Entity Search',
    category: 'Government',
    protocol: 'REST',
    description: 'Utah Dept of Commerce business registration lookup',
    url: 'https://secure.utah.gov/bes/index.html',
    searchTypes: ['name', 'business'],
    free: true,
  },
  {
    name: 'Utah Voter Records',
    category: 'Government',
    protocol: 'REST',
    description: 'Utah voter registration records — address, party, registration date',
    url: 'https://votesearch.utah.gov/voter-search/search/search-by-voter/voter-info',
    searchTypes: ['name', 'address'],
    free: true,
  },
  {
    name: 'UCC Filing Search',
    category: 'Government',
    protocol: 'REST',
    description: 'Uniform Commercial Code filings — secured transactions, liens',
    url: 'https://secure.utah.gov/uccs/',
    searchTypes: ['name', 'business'],
    free: true,
  },

  // ── People Search / Data Aggregators ──
  {
    name: 'Pipl People Search API',
    category: 'People Search',
    protocol: 'REST',
    description: 'Comprehensive people search — name, email, phone, username, address',
    url: 'https://pipl.com/api',
    searchTypes: ['name', 'email', 'phone', 'address'],
    free: false,
  },
  {
    name: 'Whitepages Pro API',
    category: 'People Search',
    protocol: 'REST',
    description: 'Identity verification, phone lookup, address validation, background checks',
    url: 'https://pro.whitepages.com/developer/',
    searchTypes: ['name', 'phone', 'address'],
    free: false,
  },
  {
    name: 'BeenVerified API',
    category: 'People Search',
    protocol: 'REST',
    description: 'People search, reverse phone, email lookup, property records',
    url: 'https://www.beenverified.com/',
    searchTypes: ['name', 'phone', 'email', 'address'],
    free: false,
  },
  {
    name: 'TLOxp (TransUnion)',
    category: 'People Search',
    protocol: 'REST',
    description: 'Law enforcement people search — SSN trace, address history, associates',
    url: 'https://www.tlo.com/',
    searchTypes: ['name', 'phone', 'address', 'all'],
    free: false,
  },
  {
    name: 'Spokeo API',
    category: 'People Search',
    protocol: 'REST',
    description: 'People search aggregator — social profiles, phone, email, address',
    url: 'https://www.spokeo.com/',
    searchTypes: ['name', 'phone', 'email'],
    free: false,
  },
  {
    name: 'NumVerify Phone Validation',
    category: 'Phone Lookup',
    protocol: 'REST',
    description: 'Phone number validation, carrier detection, line type identification',
    url: 'https://numverify.com/',
    searchTypes: ['phone'],
    free: true,
  },

  // ── Social Media ──
  {
    name: 'Social Blade API',
    category: 'Social',
    protocol: 'REST',
    description: 'Social media analytics — YouTube, Twitter, Instagram, TikTok stats',
    url: 'https://socialblade.com/api',
    searchTypes: ['name'],
    free: false,
  },
  {
    name: 'GitHub Users API',
    category: 'Social',
    protocol: 'REST',
    description: 'Search GitHub users by username, name, email — location, company info',
    url: 'https://api.github.com/search/users',
    searchTypes: ['name', 'email'],
    free: true,
  },
  {
    name: 'Gravatar Profile API',
    category: 'Social',
    protocol: 'REST',
    description: 'Profile data linked to email address — name, bio, accounts, photos',
    url: 'https://en.gravatar.com/site/implement/profiles/',
    searchTypes: ['email'],
    free: true,
  },

  // ── Financial / Property ──
  {
    name: 'OpenCorporates API',
    category: 'Financial',
    protocol: 'REST',
    description: 'Corporate registry search — officers, filings, subsidiaries worldwide',
    url: 'https://api.opencorporates.com/',
    searchTypes: ['name', 'business'],
    free: true,
  },
  {
    name: 'SLC County Assessor',
    category: 'Property',
    protocol: 'REST',
    description: 'Salt Lake County property records — ownership, value, parcel data',
    url: 'https://slco.org/assessor/',
    searchTypes: ['address', 'property', 'name'],
    free: true,
  },
  {
    name: 'Zillow API (Bridge)',
    category: 'Property',
    protocol: 'REST',
    description: 'Property data, Zestimates, ownership history, comparable sales',
    url: 'https://www.zillow.com/howto/api/APIOverview.htm',
    searchTypes: ['address', 'property'],
    free: false,
  },

  // ── Address / Mapping ──
  {
    name: 'USPS Address Validation',
    category: 'Address',
    protocol: 'REST',
    description: 'US Postal Service address standardization and validation',
    url: 'https://www.usps.com/business/web-tools-apis/',
    searchTypes: ['address'],
    free: true,
  },
  {
    name: 'Google Geocoding API',
    category: 'Address',
    protocol: 'REST',
    description: 'Convert addresses to coordinates, reverse geocode, place details',
    url: 'https://developers.google.com/maps/documentation/geocoding',
    searchTypes: ['address'],
    free: false,
  },

  // ── Email Verification ──
  {
    name: 'Hunter.io Email Finder',
    category: 'Email',
    protocol: 'REST',
    description: 'Find email addresses by domain or name — verify deliverability',
    url: 'https://hunter.io/api',
    searchTypes: ['email', 'name'],
    free: false,
  },
  {
    name: 'Have I Been Pwned',
    category: 'Email',
    protocol: 'REST',
    description: 'Check if email appeared in data breaches — breach exposure analysis',
    url: 'https://haveibeenpwned.com/API/v3',
    searchTypes: ['email'],
    free: false,
  },

  // ── Vehicle / VIN ──
  {
    name: 'NHTSA VIN Decoder',
    category: 'Vehicle',
    protocol: 'REST',
    description: 'Decode VINs — year, make, model, body class, engine, plant info',
    url: 'https://vpic.nhtsa.dot.gov/api/',
    searchTypes: ['all'],
    free: true,
  },
  {
    name: 'NHTSA Recalls API',
    category: 'Vehicle',
    protocol: 'REST',
    description: 'Vehicle recall lookup by VIN, make/model, or year',
    url: 'https://api.nhtsa.gov/recalls',
    searchTypes: ['all'],
    free: true,
  },
];

// ============================================================
// Source Implementation
// ============================================================

export default class ProgrammableWebSource extends BaseDataSource {
  readonly name = 'api_directory';
  readonly displayName = 'API Reference Directory';
  readonly category: SourceCategory = 'reference';
  readonly costPerLookup = 0;

  isConfigured(): boolean {
    return true;
  }

  isEnabled(): boolean {
    return true;
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    // Determine search type from the query
    const searchType = this.detectSearchType(query);

    // Filter directory entries matching the search type
    const matchingApis = API_DIRECTORY.filter(api =>
      api.searchTypes.includes(searchType) || api.searchTypes.includes('all')
    );

    if (matchingApis.length === 0) return [];

    // Group by category for organized output
    const byCategory = new Map<string, ApiDirectoryEntry[]>();
    for (const api of matchingApis) {
      const cat = api.category;
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(api);
    }

    // Build a reference result with suggested sources
    const suggestions = matchingApis.map(api => ({
      name: api.name,
      category: api.category,
      url: api.url,
      protocol: api.protocol,
      description: api.description,
      free: api.free,
    }));

    const freeCount = matchingApis.filter(a => a.free).length;
    const paidCount = matchingApis.length - freeCount;

    const result: SourceResult = {
      source: this.name,
      sourceType: this.category,
      confidence: 0.1, // Low confidence — this is reference data, not actual results
      fetchedAt: localNow(),
      rawResultCount: matchingApis.length,
      meta: {
        searchType,
        totalApis: matchingApis.length,
        freeApis: freeCount,
        paidApis: paidCount,
        categories: Array.from(byCategory.keys()),
        suggestions,
      },
    };

    return [result];
  }

  private detectSearchType(query: SearchQuery): 'name' | 'phone' | 'email' | 'address' | 'business' | 'property' {
    if (query.phone) return 'phone';
    if (query.email) return 'email';
    if (query.address) return 'address';
    return 'name';
  }
}
