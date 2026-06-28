// ============================================================
// Utah Justice Courts dropdown source
// ============================================================
// Single source of truth for the court-picker in CitationAuthor.
// Justice Courts in Utah are city/county-level limited-jurisdiction
// courts that handle infraction-level traffic offenses, Class B/C
// misdemeanors, and small claims. RMPG's contracted zones fall under
// various Salt Lake County, Utah County, Davis County, and Weber
// County Justice Courts.
//
// Data sourced from utcourts.gov directory of justice courts as of
// 2026-06-22. When courts move or merge, update this file.

export interface UtahJusticeCourt {
  /** Stable identifier for dropdowns, URLs, audit trails. */
  id: string;
  /** Human-readable court name as it appears on case captions. */
  name: string;
  /** Mailing address — printed on the citation's court block. */
  address: string;
  /** County the court resides in. */
  county: string;
  /** Phone number — printed on the citation. */
  phone?: string;
}

export const UTAH_JUSTICE_COURTS: ReadonlyArray<UtahJusticeCourt> = [
  // ── Salt Lake County (primary RMPG operating zone) ────────
  {
    id: 'slco-west-jordan',
    name: 'Salt Lake County Justice Court — West Jordan',
    address: '8080 South Redwood Road, West Jordan, UT 84088',
    county: 'Salt Lake',
    phone: '(385) 468-7300',
  },
  {
    id: 'slco-salt-lake-city',
    name: 'Salt Lake City Justice Court',
    address: '333 South 200 East, Salt Lake City, UT 84111',
    county: 'Salt Lake',
    phone: '(801) 535-6300',
  },
  {
    id: 'slco-sandy',
    name: 'Sandy City Justice Court',
    address: '210 West Sego Lily Drive, Sandy, UT 84070',
    county: 'Salt Lake',
    phone: '(801) 568-7160',
  },
  {
    id: 'slco-murray',
    name: 'Murray City Justice Court',
    address: '5025 South State Street, Murray, UT 84107',
    county: 'Salt Lake',
    phone: '(801) 264-2660',
  },
  {
    id: 'slco-west-valley',
    name: 'West Valley City Justice Court',
    address: '3590 South 2700 West, West Valley City, UT 84119',
    county: 'Salt Lake',
    phone: '(801) 963-3270',
  },
  {
    id: 'slco-south-jordan',
    name: 'South Jordan City Justice Court',
    address: '1600 West Towne Center Drive, South Jordan, UT 84095',
    county: 'Salt Lake',
    phone: '(801) 446-4357',
  },
  {
    id: 'slco-draper',
    name: 'Draper City Justice Court',
    address: '1020 East Pioneer Road, Draper, UT 84020',
    county: 'Salt Lake',
    phone: '(801) 576-6500',
  },
  {
    id: 'slco-cottonwood-heights',
    name: 'Cottonwood Heights Justice Court',
    address: '2277 East Bengal Boulevard, Cottonwood Heights, UT 84121',
    county: 'Salt Lake',
    phone: '(801) 944-7050',
  },
  {
    id: 'slco-midvale',
    name: 'Midvale City Justice Court',
    address: '7505 South Holden Street, Midvale, UT 84047',
    county: 'Salt Lake',
    phone: '(801) 567-7200',
  },
  {
    id: 'slco-taylorsville',
    name: 'Taylorsville City Justice Court',
    address: '2600 West Taylorsville Boulevard, Taylorsville, UT 84129',
    county: 'Salt Lake',
    phone: '(801) 963-5400',
  },
  {
    id: 'slco-millcreek',
    name: 'Millcreek Justice Court',
    address: '3330 South 1300 East, Millcreek, UT 84106',
    county: 'Salt Lake',
    phone: '(801) 214-2700',
  },
  {
    id: 'slco-holladay',
    name: 'Holladay City Justice Court',
    address: '4580 South 2300 East, Holladay, UT 84117',
    county: 'Salt Lake',
    phone: '(801) 272-9450',
  },
  {
    id: 'slco-herriman',
    name: 'Herriman City Justice Court',
    address: '5355 West Herriman Main Street, Herriman, UT 84096',
    county: 'Salt Lake',
    phone: '(801) 446-5323',
  },
  {
    id: 'slco-bluffdale',
    name: 'Bluffdale City Justice Court',
    address: '14175 South Redwood Road, Bluffdale, UT 84065',
    county: 'Salt Lake',
    phone: '(801) 254-2200',
  },
  {
    id: 'slco-riverton',
    name: 'Riverton City Justice Court',
    address: '12830 South Redwood Road, Riverton, UT 84065',
    county: 'Salt Lake',
    phone: '(801) 254-0704',
  },

  // ── Utah County ──────────────────────────────────────────
  {
    id: 'utco-orem',
    name: 'Orem City Justice Court',
    address: '56 North State Street, Orem, UT 84057',
    county: 'Utah',
    phone: '(801) 229-7140',
  },
  {
    id: 'utco-provo',
    name: 'Provo City Justice Court',
    address: '359 West Center Street, Provo, UT 84601',
    county: 'Utah',
    phone: '(801) 852-6878',
  },
  {
    id: 'utco-american-fork',
    name: 'American Fork City Justice Court',
    address: '75 East Main Street, American Fork, UT 84003',
    county: 'Utah',
    phone: '(801) 763-3050',
  },
  {
    id: 'utco-lehi',
    name: 'Lehi City Justice Court',
    address: '153 North 100 East, Lehi, UT 84043',
    county: 'Utah',
    phone: '(385) 201-1090',
  },
  {
    id: 'utco-pleasant-grove',
    name: 'Pleasant Grove City Justice Court',
    address: '85 East 100 South, Pleasant Grove, UT 84062',
    county: 'Utah',
    phone: '(801) 785-5009',
  },
  {
    id: 'utco-spanish-fork',
    name: 'Spanish Fork City Justice Court',
    address: '40 South Main Street, Spanish Fork, UT 84660',
    county: 'Utah',
  },
  {
    id: 'utco-springville',
    name: 'Springville City Justice Court',
    address: '110 South Main Street, Springville, UT 84663',
    county: 'Utah',
  },
  {
    id: 'utco-saratoga-springs',
    name: 'Saratoga Springs City Justice Court',
    address: '1307 North Commerce Drive, Saratoga Springs, UT 84045',
    county: 'Utah',
  },
  {
    id: 'utco-eagle-mountain',
    name: 'Eagle Mountain City Justice Court',
    address: '1650 East Stagecoach Run, Eagle Mountain, UT 84005',
    county: 'Utah',
  },

  // ── Davis County ─────────────────────────────────────────
  {
    id: 'dvco-bountiful',
    name: 'Bountiful City Justice Court',
    address: '790 South 100 East, Bountiful, UT 84010',
    county: 'Davis',
  },
  {
    id: 'dvco-layton',
    name: 'Layton City Justice Court',
    address: '425 North Wasatch Drive, Layton, UT 84041',
    county: 'Davis',
  },
  {
    id: 'dvco-clearfield',
    name: 'Clearfield City Justice Court',
    address: '55 South State Street, Clearfield, UT 84015',
    county: 'Davis',
  },
  {
    id: 'dvco-kaysville',
    name: 'Kaysville City Justice Court',
    address: '23 East Center Street, Kaysville, UT 84037',
    county: 'Davis',
  },
  {
    id: 'dvco-syracuse',
    name: 'Syracuse City Justice Court',
    address: '1979 West 1900 South, Syracuse, UT 84075',
    county: 'Davis',
  },
  {
    id: 'dvco-farmington',
    name: 'Farmington City Justice Court',
    address: '160 South Main Street, Farmington, UT 84025',
    county: 'Davis',
  },
  {
    id: 'dvco-centerville',
    name: 'Centerville City Justice Court',
    address: '250 North Main Street, Centerville, UT 84014',
    county: 'Davis',
  },

  // ── Weber County ─────────────────────────────────────────
  {
    id: 'wbco-ogden',
    name: 'Ogden City Justice Court',
    address: '2549 Washington Boulevard, Ogden, UT 84401',
    county: 'Weber',
  },
  {
    id: 'wbco-roy',
    name: 'Roy City Justice Court',
    address: '5051 South 1900 West, Roy, UT 84067',
    county: 'Weber',
  },
  {
    id: 'wbco-north-ogden',
    name: 'North Ogden City Justice Court',
    address: '505 East 2600 North, North Ogden, UT 84414',
    county: 'Weber',
  },
  {
    id: 'wbco-south-ogden',
    name: 'South Ogden City Justice Court',
    address: '3950 South Adams Avenue, South Ogden, UT 84403',
    county: 'Weber',
  },
  {
    id: 'wbco-washington-terrace',
    name: 'Washington Terrace City Justice Court',
    address: '5249 South 400 East, Washington Terrace, UT 84405',
    county: 'Weber',
  },

  // ── Tooele County ────────────────────────────────────────
  {
    id: 'tlco-tooele',
    name: 'Tooele City Justice Court',
    address: '90 North Main Street, Tooele, UT 84074',
    county: 'Tooele',
  },
  {
    id: 'tlco-grantsville',
    name: 'Grantsville City Justice Court',
    address: '429 East Main Street, Grantsville, UT 84029',
    county: 'Tooele',
  },

  // ── Summit County ────────────────────────────────────────
  {
    id: 'smco-park-city',
    name: 'Park City Justice Court',
    address: '445 Marsac Avenue, Park City, UT 84060',
    county: 'Summit',
  },

  // ── Wasatch County ───────────────────────────────────────
  {
    id: 'wsco-heber',
    name: 'Heber City Justice Court',
    address: '75 North Main Street, Heber City, UT 84032',
    county: 'Wasatch',
  },

  // ── Washington County (St. George area) ──────────────────
  {
    id: 'wgco-st-george',
    name: 'St. George Justice Court',
    address: '175 East 200 North, St. George, UT 84770',
    county: 'Washington',
  },
  {
    id: 'wgco-washington-city',
    name: 'Washington City Justice Court',
    address: '111 North 100 East, Washington City, UT 84780',
    county: 'Washington',
  },
  {
    id: 'wgco-hurricane',
    name: 'Hurricane City Justice Court',
    address: '147 North 870 West, Hurricane, UT 84737',
    county: 'Washington',
  },

  // ── County Justice Courts (catch-all, used when no city JC) ──
  {
    id: 'salt-lake-county',
    name: 'Salt Lake County Justice Court (Main)',
    address: '2001 South State Street, Salt Lake City, UT 84190',
    county: 'Salt Lake',
  },
  {
    id: 'utah-county',
    name: 'Utah County Justice Court',
    address: '125 North 100 West, Provo, UT 84601',
    county: 'Utah',
  },
  {
    id: 'davis-county',
    name: 'Davis County Justice Court',
    address: '800 West State Street, Farmington, UT 84025',
    county: 'Davis',
  },
  {
    id: 'weber-county',
    name: 'Weber County Justice Court',
    address: '2380 Washington Boulevard, Ogden, UT 84401',
    county: 'Weber',
  },
];

/**
 * Lookup a court by id. Returns undefined if no match — call sites
 * must handle that (e.g., the workspace default kicks in).
 */
export function findCourtById(id: string | null | undefined): UtahJusticeCourt | undefined {
  if (!id) return undefined;
  return UTAH_JUSTICE_COURTS.find((c) => c.id === id);
}

/**
 * Group courts by county for the dropdown UI — counties show as
 * <optgroup> headers so officers can scan to the right region quickly.
 */
export function courtsByCounty(): Record<string, UtahJusticeCourt[]> {
  const grouped: Record<string, UtahJusticeCourt[]> = {};
  for (const c of UTAH_JUSTICE_COURTS) {
    if (!grouped[c.county]) grouped[c.county] = [];
    grouped[c.county].push(c);
  }
  return grouped;
}
