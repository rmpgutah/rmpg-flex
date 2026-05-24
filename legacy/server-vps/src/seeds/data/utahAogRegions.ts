// Utah Associations of Government (AOG) region definitions.
// Used by geographySeed.ts to populate dispatch_areas and link
// dispatch_sectors (counties) to their parent AOG.
//
// Wasatch Front combines WFRC (Weber/Davis/Morgan/SL/Tooele) +
// MAG (Utah/Wasatch/Summit) into a single region per the design
// decision. Can be split later without a schema migration by
// editing this constant and reseeding.

export const UTAH_AOG_REGIONS = {
  BEAR_RIVER: {
    name: 'Bear River',
    counties: ['BOX ELDER', 'CACHE', 'RICH'],
    color: '#d4a017',
    sort_order: 1,
  },
  WASATCH_FRONT: {
    name: 'Wasatch Front',
    counties: [
      'WEBER',
      'MORGAN',
      'DAVIS',
      'SALT LAKE',
      'TOOELE',
      'SUMMIT',
      'UTAH',
      'WASATCH',
    ],
    color: '#a0a0a0',
    sort_order: 2,
  },
  SIX_COUNTY: {
    name: 'Six County',
    counties: ['JUAB', 'MILLARD', 'PIUTE', 'SANPETE', 'SEVIER', 'WAYNE'],
    color: '#888888',
    sort_order: 3,
  },
  UINTAH_BASIN: {
    name: 'Uintah Basin',
    counties: ['DAGGETT', 'DUCHESNE', 'UINTAH'],
    color: '#707070',
    sort_order: 4,
  },
  SOUTHEASTERN: {
    name: 'Southeastern',
    counties: ['CARBON', 'EMERY', 'GRAND', 'SAN JUAN'],
    color: '#5a5a5a',
    sort_order: 5,
  },
  FIVE_COUNTY: {
    name: 'Five County',
    counties: ['BEAVER', 'GARFIELD', 'IRON', 'KANE', 'WASHINGTON'],
    color: '#c8c8c8',
    sort_order: 6,
  },
} as const;

export type AogRegionKey = keyof typeof UTAH_AOG_REGIONS;

// Reverse lookup: county NAME (uppercased) → AOG region key
export const COUNTY_TO_AOG: Record<string, AogRegionKey> = {};
for (const [key, region] of Object.entries(UTAH_AOG_REGIONS) as [
  AogRegionKey,
  (typeof UTAH_AOG_REGIONS)[AogRegionKey],
][]) {
  for (const county of region.counties) {
    COUNTY_TO_AOG[county.toUpperCase()] = key;
  }
}

// Sector code disambiguation for county names that would collide on
// 3-letter prefix, or need to match existing beat.geojson city_codes.
// See `client/public/geojson/beat.geojson` for the canonical city_code
// values — sector codes should match for the unincorporated-zone lookup.
export const SECTOR_CODE_OVERRIDES: Record<string, string> = {
  'SAN JUAN': 'SJN',
  SANPETE: 'SNP',
  'BOX ELDER': 'BXE',
  'SALT LAKE': 'SLC',
  UINTAH: 'UNT',
  UTAH: 'UTC',
  CACHE: 'CCH',
  DAVIS: 'DVS',
  MILLARD: 'MLD',
  WASHINGTON: 'WSH',
  WEBER: 'WBR',
  JUAB: 'JUB',
  GARFIELD: 'GRF',
  RICH: 'RCH',
  CARBON: 'CRB',
  DAGGETT: 'DGT',
  BEAVER: 'BVR',
  SEVIER: 'SVR',
  GRAND: 'GRD',
  TOOELE: 'TOO',
  SUMMIT: 'SMT',
  PIUTE: 'PUT',
  IRON: 'IRN',
  EMERY: 'EMR',
  WAYNE: 'WYN',
  MORGAN: 'MRG',
  KANE: 'KNE',
  DUCHESNE: 'DCH',
  WASATCH: 'WSC',
};
