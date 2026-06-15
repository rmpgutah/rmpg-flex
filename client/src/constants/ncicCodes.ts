// ============================================================
// RMPG Flex — NCIC / NLETS Data Codes
//
// Authoritative bidirectional code tables + pure translate
// helpers used by the NCIC terminal (ncicFormatter.ts for
// output rendering, NcicQueryPanel.tsx for input). Single
// source of truth, mirroring lawEnforcementEnums.ts.
//
// Codes follow the NCIC Code Manual (person descriptors,
// vehicle make/color/style) and Utah DLD / Utah Code where
// state-specific. Unknown values degrade gracefully to the
// raw value uppercased — the helpers never throw.
// ============================================================

export type NcicDomain =
  | 'RACE' | 'ETHNICITY' | 'SEX' | 'EYE' | 'HAIR'
  | 'VMA' | 'VCO' | 'VST'
  | 'STATE' | 'DL_CLASS' | 'DL_RESTRICTION' | 'DL_ENDORSEMENT';

interface CodeTable {
  toLabel: Map<string, string>; // CODE -> canonical Title-case label
  toCode: Map<string, string>;  // lowercased label/alias/code -> CODE
}

// Each row: [code, canonicalLabel, ...aliases]. Aliases let stored
// values that differ from the canonical label still resolve.
type Row = [string, string, ...string[]];

function makeTable(rows: Row[]): CodeTable {
  const toLabel = new Map<string, string>();
  const toCode = new Map<string, string>();
  for (const [code, label, ...aliases] of rows) {
    const C = code.toUpperCase();
    toLabel.set(C, label);
    toCode.set(label.toLowerCase(), C);
    toCode.set(C.toLowerCase(), C);
    for (const a of aliases) toCode.set(a.toLowerCase(), C);
  }
  return { toLabel, toCode };
}

// ── Person descriptors ──────────────────────────────────────

// NCIC race: W/B/I/A/U. (Hispanic is ETHNICITY, not race.)
const RACE = makeTable([
  ['W', 'White', 'Middle Eastern', 'Caucasian'],
  ['B', 'Black', 'African American'],
  ['I', 'American Indian', 'Native American', 'Alaska Native', 'Indigenous'],
  ['A', 'Asian', 'Pacific Islander', 'Asian/Pacific Islander'],
  ['U', 'Unknown', 'Mixed', 'Other'],
]);

const ETHNICITY = makeTable([
  ['H', 'Hispanic', 'Latino', 'Latina', 'Latinx'],
  ['N', 'Not Hispanic'],
  ['U', 'Unknown'],
]);

// NCIC sex: M/F/U. X retained for non-binary/other (modern).
const SEX = makeTable([
  ['M', 'Male'],
  ['F', 'Female'],
  ['X', 'Non-Binary', 'Other'],
  ['U', 'Unknown'],
]);

// NCIC eye color codes.
const EYE = makeTable([
  ['BLK', 'Black'],
  ['BLU', 'Blue'],
  ['BRO', 'Brown'],
  ['GRN', 'Green'],
  ['GRY', 'Gray'],
  ['HAZ', 'Hazel'],
  ['MAR', 'Maroon'],
  ['MUL', 'Multicolored'],
  ['PNK', 'Pink'],
  ['XXX', 'Unknown'],
]);

// NCIC hair color codes.
const HAIR = makeTable([
  ['BAL', 'Bald'],
  ['BLK', 'Black'],
  ['BLN', 'Blond', 'Blonde'],
  ['BLU', 'Blue'],
  ['BRO', 'Brown'],
  ['GRY', 'Gray', 'Grey'],
  ['GRN', 'Green'],
  ['ONG', 'Orange'],
  ['PNK', 'Pink'],
  ['PLE', 'Purple'],
  ['RED', 'Red', 'Auburn'],
  ['SDY', 'Sandy'],
  ['WHI', 'White'],
  ['XXX', 'Unknown'],
]);

// ── Vehicle make (NCIC VMA) ─────────────────────────────────
const VMA = makeTable([
  ['ACUR', 'Acura'], ['AMER', 'AMC', 'American Motors'], ['AUDI', 'Audi'],
  ['BMW', 'BMW'], ['BUIC', 'Buick'], ['CADI', 'Cadillac'],
  ['CHEV', 'Chevrolet', 'Chevy'], ['CHRY', 'Chrysler'], ['DODG', 'Dodge'],
  ['FIAT', 'Fiat'], ['FORD', 'Ford'], ['GENS', 'Genesis'], ['GEO', 'Geo'],
  ['GMC', 'GMC'], ['HOND', 'Honda'], ['HUMM', 'Hummer'], ['HYUN', 'Hyundai'],
  ['INFI', 'Infiniti'], ['ISU', 'Isuzu'], ['JAGU', 'Jaguar'], ['JEEP', 'Jeep'],
  ['KIA', 'Kia'], ['LEXS', 'Lexus'], ['LINC', 'Lincoln'],
  ['LNDR', 'Land Rover', 'Range Rover'], ['MAZD', 'Mazda'],
  ['MERZ', 'Mercedes-Benz', 'Mercedes'], ['MERC', 'Mercury'], ['MNNI', 'Mini'],
  ['MITS', 'Mitsubishi'], ['NISS', 'Nissan'], ['OLDS', 'Oldsmobile'],
  ['PLYM', 'Plymouth'], ['PONT', 'Pontiac'], ['PORS', 'Porsche'],
  ['RAM', 'Ram'], ['SATR', 'Saturn'], ['SCIO', 'Scion'], ['SMRT', 'Smart'],
  ['SUBA', 'Subaru'], ['SUZI', 'Suzuki'], ['TESL', 'Tesla'],
  ['TOYT', 'Toyota'], ['VOLK', 'Volkswagen', 'VW'], ['VOLV', 'Volvo'],
  ['HD', 'Harley-Davidson', 'Harley'],
]);

// ── Vehicle color (NCIC VCO) ────────────────────────────────
const VCO = makeTable([
  ['BGE', 'Beige'], ['BLK', 'Black'], ['BLU', 'Blue'], ['BRO', 'Brown'],
  ['BRZ', 'Bronze'], ['CPR', 'Copper'], ['CRM', 'Cream', 'Ivory'],
  ['DBL', 'Dark Blue', 'Navy'], ['DGR', 'Dark Green'], ['GLD', 'Gold'],
  ['GRY', 'Gray', 'Grey', 'Charcoal', 'Dark Gray', 'Light Gray'],
  ['GRN', 'Green'], ['LAV', 'Lavender'], ['LBL', 'Light Blue'],
  ['LGR', 'Light Green'], ['MAR', 'Maroon', 'Burgundy', 'Dark Red'],
  ['ONG', 'Orange'], ['PNK', 'Pink'], ['PLE', 'Purple'], ['RED', 'Red'],
  ['SIL', 'Silver'], ['TAN', 'Tan'], ['TEL', 'Teal'], ['TRQ', 'Turquoise'],
  ['WHI', 'White'], ['YEL', 'Yellow'], ['MUL', 'Multicolored', 'Multi-Color'],
]);

// ── Vehicle body style (NCIC VST) ───────────────────────────
const VST = makeTable([
  ['2D', '2-Door', 'Coupe (2-Door)'], ['4D', 'Sedan 4-Door', 'Sedan (4-Door)', 'Sedan'],
  ['CP', 'Coupe'], ['CV', 'Convertible'], ['SW', 'Station Wagon', 'Wagon'],
  ['HB', 'Hatchback'], ['UV', 'Utility', 'SUV', 'Crossover', 'ATV / UTV'],
  ['PK', 'Pickup', 'Pickup Truck'], ['VN', 'Van', 'Minivan', 'Cargo Van'],
  ['BU', 'Bus'], ['MC', 'Motorcycle', 'Scooter', 'Moped'],
  ['TL', 'Trailer'], ['TK', 'Truck', 'Box Truck', 'Flatbed', 'Tow Truck', 'Dump Truck'],
  ['TR', 'Truck Tractor', 'Semi Tractor'],
]);

// ── US states / territories + common Canadian provinces (NLETS) ─
const STATE = makeTable([
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'],
  ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
  ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['DC', 'District of Columbia'],
  ['PR', 'Puerto Rico'], ['GU', 'Guam'], ['VI', 'U.S. Virgin Islands'],
  ['AS', 'American Samoa'], ['MP', 'Northern Mariana Islands'],
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'],
  ['ON', 'Ontario'], ['QC', 'Quebec'],
]);

// ── Utah DL class (Utah DLD) ────────────────────────────────
const DL_CLASS = makeTable([
  ['A', 'Commercial A', 'CDL-A'], ['B', 'Commercial B', 'CDL-B'],
  ['C', 'Commercial C', 'CDL-C'], ['D', 'Operator', 'Standard', 'Class D'],
  ['M', 'Motorcycle'],
]);

// ── DL restrictions (common) ────────────────────────────────
const DL_RESTRICTION = makeTable([
  ['A', 'Corrective Lenses'], ['B', 'Outside Mirror'], ['C', 'Mechanical Aid'],
  ['E', 'No Manual Transmission'], ['L', 'No Air Brakes'],
]);

// ── CDL endorsements (federally standardized) ───────────────
const DL_ENDORSEMENT = makeTable([
  ['H', 'Hazardous Materials'], ['N', 'Tank Vehicles'], ['P', 'Passenger'],
  ['S', 'School Bus'], ['T', 'Double/Triple Trailers'], ['X', 'Hazmat + Tank'],
]);

// Registry of label-based domains. (OFFENSE is handled separately
// because it returns a structured entry, not a single code.)
const TABLES: Record<NcicDomain, CodeTable> = {
  RACE, ETHNICITY, SEX, EYE, HAIR,
  VMA, VCO, VST,
  STATE, DL_CLASS, DL_RESTRICTION, DL_ENDORSEMENT,
};

// ── Core helpers (pure) ─────────────────────────────────────

/** label/alias/code → NCIC code; falls back to uppercased input. */
export function encode(domain: NcicDomain, value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  return TABLES[domain].toCode.get(v.toLowerCase()) ?? v.toUpperCase();
}

/** code (or label) → canonical label; falls back to uppercased input. */
export function decode(domain: NcicDomain, value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  const t = TABLES[domain];
  const asCode = v.toUpperCase();
  if (t.toLabel.has(asCode)) return t.toLabel.get(asCode)!;
  const code = t.toCode.get(v.toLowerCase());
  return code ? t.toLabel.get(code)! : v.toUpperCase();
}

/** "CODE (LABEL)"; "" for empty; raw uppercased value if no code exists. */
export function fmtCoded(domain: NcicDomain, value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  const code = encode(domain, v);
  const label = TABLES[domain].toLabel.get(code);
  return label ? `${code} (${label.toUpperCase()})` : v.toUpperCase();
}

/** Hispanic-aware race rendering: race line + optional ethnicity line. */
export function formatRaceEthnicity(rawRace: string | null | undefined): { rac: string; etn: string | null } {
  const v = (rawRace ?? '').trim();
  if (!v) return { rac: '', etn: null };
  if (/^(hispanic|latin)/i.test(v)) {
    return { rac: fmtCoded('RACE', 'U'), etn: fmtCoded('ETHNICITY', 'Hispanic') };
  }
  return { rac: fmtCoded('RACE', v), etn: null };
}

/** Height → NCIC 3-digit feet+inches (e.g. 5'10" -> "510"). "" if unparseable. */
export function normalizeHeight(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  // Already NCIC form: 3 digits, feet 4-7, inches 00-11.
  if (/^[4-7]\d{2}$/.test(s) && Number(s.slice(1)) <= 11) return s;
  // feet+inches with an explicit separator: 5'10", 6 ft 11 in, 5 feet 10
  const fi = s.match(/^(\d)\s*(?:ft|feet|')\s*(\d{1,2})\s*(?:in|inches|''|")?\.?$/i);
  if (fi) {
    const ft = Number(fi[1]); const inch = Number(fi[2]);
    if (ft >= 1 && ft <= 7 && inch <= 11) return `${ft}${String(inch).padStart(2, '0')}`;
  }
  // total inches (e.g. "70in", "70")
  const totalIn = s.match(/^(\d{2,3})\s*(?:in|inches|")?$/i);
  if (totalIn) {
    const t = Number(totalIn[1]);
    if (t >= 36 && t <= 95) return `${Math.floor(t / 12)}${String(t % 12).padStart(2, '0')}`;
  }
  return '';
}

/** Weight → NCIC 3-digit pounds. "" if unparseable or out of range. */
export function normalizeWeight(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const m = String(value).trim().match(/^(\d{1,3})(?:\s*(?:lbs?|pounds?|kg))?$/i);
  if (!m) return '';
  return String(Number(m[1])).padStart(3, '0');
}
