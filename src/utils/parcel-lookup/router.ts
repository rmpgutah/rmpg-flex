// Resolves which county's assessor/recorder package should handle a given
// address. Closed, hardcoded city lists per county (each county's own
// address-search form enumerates its incorporated cities/districts, so
// this is a small, stable set — not a general geocoder). ZIP-prefix is a
// fallback for addresses that don't carry a recognizable city token.
//
// Returns 'unsupported' (never guesses) for anything outside the four
// covered counties — this includes Davis County, which is deliberately
// NOT covered pending a separate spike (see docs/superpowers/specs/
// 2026-07-14-multi-county-assessor-design.md).

export type County = 'salt_lake' | 'utah' | 'summit' | 'tooele' | 'unsupported';

const SALT_LAKE_CITIES = [
  'salt lake city', 'west valley city', 'west jordan', 'sandy', 'south jordan',
  'taylorsville', 'murray', 'draper', 'riverton', 'midvale', 'cottonwood heights',
  'holladay', 'south salt lake', 'herriman', 'bluffdale', 'millcreek',
  'magna', 'kearns', 'copperton', 'alta', 'brighton', 'emigration canyon',
];

const UTAH_COUNTY_CITIES = [
  'alpine', 'american fork', 'benjamin', 'birdseye', 'cedar fort', 'cedar hills',
  'cedar valley', 'colton', 'covered bridge', 'diamond fork canyon', 'draper',
  'eagle mountain', 'elberta', 'elk ridge', 'eureka', 'fairfield', 'fairview',
  'genola', 'goshen', 'highland', 'lake shore', 'lehi', 'leland', 'lindon',
  'mapleton', 'orem', 'palmyra', 'payson', 'pleasant grove', 'provo',
  'salem', 'santaquin', 'saratoga springs', 'spanish fork', 'spring lake',
  'springville', 'sundance', 'thistle', 'vineyard', 'west mountain', 'woodland hills',
];

const SUMMIT_COUNTY_CITIES = [
  'park city', 'coalville', 'kamas', 'oakley', 'francis', 'henefer', 'echo',
  'snyderville', 'kimball junction', 'hideout',
];

const TOOELE_COUNTY_CITIES = [
  'tooele', 'grantsville', 'stansbury park', 'erda', 'lake point',
  'stockton', 'rush valley', 'ophir', 'vernon', 'wendover',
];

// ZIP5 is a fallback only — checked after city-name matching fails. There is
// deliberately NO ZIP3-prefix fallback: Utah, Davis, and Salt Lake counties
// all share the 840 ZIP3 range, so a coarse prefix match would misroute
// Davis County addresses (unsupported) into Utah County. Exact 5-digit ZIPs
// are unambiguous per county and safe to hardcode.
const ZIP5_TO_COUNTY: Record<string, County> = {
  '84003': 'utah', '84601': 'utah', '84604': 'utah', '84058': 'utah', '84097': 'utah',
  '84042': 'utah', '84043': 'utah', '84045': 'utah', '84062': 'utah', '84651': 'utah',
  '84060': 'summit', '84098': 'summit', '84036': 'summit', '84017': 'summit', '84033': 'summit',
  '84074': 'tooele', '84029': 'tooele', '84044': 'tooele', '84083': 'tooele',
  '84101': 'salt_lake', '84070': 'salt_lake', '84088': 'salt_lake', '84081': 'salt_lake',
  '84084': 'salt_lake', '84020': 'salt_lake', '84065': 'salt_lake', '84092': 'salt_lake',
  '84093': 'salt_lake', '84094': 'salt_lake', '84095': 'salt_lake', '84096': 'salt_lake',
  '84118': 'salt_lake', '84119': 'salt_lake', '84120': 'salt_lake', '84121': 'salt_lake',
  '84123': 'salt_lake', '84128': 'salt_lake',
};

function containsCity(haystack: string, cities: string[]): boolean {
  return cities.some((c) => haystack.includes(c));
}

export function resolveCountyFromAddress(address: string): County {
  const normalized = (address ?? '').toLowerCase().trim();
  if (!normalized) return 'unsupported';

  if (containsCity(normalized, SALT_LAKE_CITIES)) return 'salt_lake';
  if (containsCity(normalized, UTAH_COUNTY_CITIES)) return 'utah';
  if (containsCity(normalized, SUMMIT_COUNTY_CITIES)) return 'summit';
  if (containsCity(normalized, TOOELE_COUNTY_CITIES)) return 'tooele';

  const zipMatch = normalized.match(/\b(\d{5})\b/);
  if (zipMatch && ZIP5_TO_COUNTY[zipMatch[1]]) return ZIP5_TO_COUNTY[zipMatch[1]];

  return 'unsupported';
}
