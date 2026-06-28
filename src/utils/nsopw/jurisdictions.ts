// ============================================================
// RMPG Flex — NSOPW jurisdiction codes + labels.
// ------------------------------------------------------------
// The NSOPW v1.0 search endpoint requires an EXPLICIT array of
// jurisdiction codes — passing an empty array federates to nothing.
// The full list of 183 participating jurisdictions (50 states + 6
// territories/DC + 127 tribes) is captured here from the live
// request body (tests/fixtures/nsopw/john-smith-search.real.json).
//
// Codes are NSOPW-internal (e.g. ASTRIBE = Absentee Shawnee Tribe);
// they are NOT the same as USPS state abbreviations, FIPS codes, or
// BIA tribal codes. Treat this list as opaque: NSOPW assigns and
// rotates codes as jurisdictions join/leave the federation.
// ============================================================

/** The full canonical jurisdictions list as POSTed by nsopw.gov. */
export const NSOPW_ALL_JURISDICTIONS: ReadonlyArray<string> = [
  // Tribes (alphabetical-ish per nsopw.gov ordering)
  'ASTRIBE', 'AKCHIN', 'ACTRIBE', 'BLACKFEET', 'BOISFORTE', 'CADDO',
  'CHEROKEE', 'CATRIBES', 'CHEYENNERIVER', 'CHICKASAW', 'CHIPPEWACREE',
  'CHITIMACHA', 'POTAWATOMI', 'COCOPAH', 'CRIT', 'COMANCHE', 'CHEHALIS',
  'YAKAMA', 'COLVILLETRIBES', 'CTUIR', 'WARMSPRINGS', 'CROWNATIONS',
  'DNATION', 'NCCHEROKEE', 'ESTOO', 'ELY', 'FSST', 'FTBELKNAP',
  'FTMCDOWELL', 'MOJAVEINDIANTRIBE', 'FORTPECKTRIBES', 'GRIC', 'GTB',
  'HAVASUPAI', 'HOPI', 'HUALAPAI', 'IOWANATION', 'JICARILLA',
  'KAIBABPAIUTE', 'KALISPELTRIBE', 'KAW', 'SANTODOMINGO', 'KBIC',
  'KICKAPOO', 'ELWHA', 'LUMMI', 'MAKAH', 'MPTN', 'MITW',
  'MESCALEROAPACHE', 'METLAKATLA', 'MIAMINATION', 'MICCOSUKEETRIBE',
  'CHOCTAW', 'MODOC', 'MUSCOGEE', 'NAVAJO', 'NEZPERCE', 'NISQUALLY',
  'NOOKSACK', 'NORTHERNARAPAHO', 'NORTHERNCHEYENNE', 'NHBPI', 'OGLALA',
  'OHKAYOWINGEH', 'OMAHA', 'ONEIDA', 'OSAGE', 'OMTRIBE', 'OTTAWATRIBE',
  'PASCUAYAQUI', 'PAWNEENATION', 'PEORIATRIBE', 'PCI', 'POKAGON',
  'PORTGAMBLE', 'PBPNATION', 'SANIPUEBLO', 'PUEBLOOFACOMA', 'ISLETA',
  'JEMEZ', 'LAGUNA', 'SANTAANA', 'ZUNI', 'PUYALLUPTRIBE', 'PLPT',
  'QUAPAW', 'QUINAULT', 'REDLAKE', 'RSIC', 'ROSEBUD', 'SACANDFOXNATION',
  'MESKWAKI', 'SRPMIC', 'SCAT', 'SANTEE', 'SAULTSAINTEMARIE',
  'SEMINOLENATION', 'SCTRIBE', 'SHOALWATERBAY', 'SBTRIBES',
  'SHOSHONEPAIUTE', 'SWO', 'SKOKOMISH', 'SPIRITLAKE', 'SPOKANETRIBE',
  'SQUAXINISLAND', 'SRST', 'SUQUAMISH', 'TEMOAKTRIBE', 'MHANATION',
  'TONATION', 'TONKAWA', 'TONTOAPACHE', 'TULALIP', 'TMBCI',
  'UNITEDKEETOOWAHBAND', 'UPPERSKAGIT', 'UTETRIBE', 'WAMPANOAG',
  'WASHOETRIBE', 'WMAT', 'WINNEBAGOTRIBE', 'WYANDOTTE', 'YANKTON',
  'YAVAPAIAPACHE', 'YPIT',
  // States + DC + territories (alphabetical-ish)
  'AL', 'AK', 'AMERICANSAMOA', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE',
  'DC', 'FL', 'GA', 'GU', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV',
  'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'CNMI', 'OH', 'OK', 'OR', 'PA',
  'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'USVI', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
];

/** Human-readable labels for codes we know. Unknown codes fall back to the code itself. */
export const JURISDICTION_LABELS: Record<string, string> = {
  // States + DC
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  // Territories
  GU: 'Guam', PR: 'Puerto Rico', USVI: 'U.S. Virgin Islands',
  AMERICANSAMOA: 'American Samoa', CNMI: 'Northern Mariana Islands',
  // Selected tribal labels (the ones that actually show up most often in
  // search results — full label table is JURISDICTION_LABELS_FULL below).
  CHEROKEE: 'Cherokee Nation', NAVAJO: 'Navajo Nation', REDLAKE: 'Red Lake Band',
  OSAGE: 'Osage Nation', SEMINOLENATION: 'Seminole Nation of Oklahoma',
  MUSCOGEE: 'Muscogee (Creek) Nation', CHICKASAW: 'Chickasaw Nation',
  CHOCTAW: 'Mississippi Band of Choctaw', UTETRIBE: 'Ute Indian Tribe',
};
