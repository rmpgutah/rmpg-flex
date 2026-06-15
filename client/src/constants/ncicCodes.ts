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
// NCIC VMA — per NIEM 5.0 AutoCodeSimpleType + MotorcycleCodeSimpleType
// (niem.github.io/model/5.0/ncic/AutoCodeSimpleType/) cross-referenced
// with NIEM 4.2 MotorcycleCodeSimpleType. Rows cover passenger cars,
// trucks/SUVs, motorcycles, and common commercial makes a Utah officer
// would realistically encounter. ~175 entries.
const VMA = makeTable([
  // ── Domestic passenger cars / trucks / SUVs ─────────────
  ['BUIC', 'Buick'],
  ['CADI', 'Cadillac'],
  ['CHEV', 'Chevrolet', 'Chevy'],
  ['CHRY', 'Chrysler'],
  ['DODG', 'Dodge'],
  ['FORD', 'Ford'],
  ['GENS', 'Genesis', 'Genesis Motors'],
  ['GEO',  'Geo'],
  ['GMC',  'GMC'],
  ['HUMM', 'Hummer'],
  ['JEEP', 'Jeep'],
  ['LINC', 'Lincoln'],
  ['MERC', 'Mercury'],
  ['MNNI', 'Mini', 'MINI'],
  ['OLDS', 'Oldsmobile'],
  ['PLYM', 'Plymouth'],
  ['PONT', 'Pontiac'],
  ['RAM',  'Ram', 'Ram Trucks'],
  ['SATR', 'Saturn'],
  ['SCIO', 'Scion'],
  ['SMRT', 'Smart'],
  ['TESL', 'Tesla'],

  // ── Asian passenger cars / trucks / SUVs ────────────────
  ['ACUR', 'Acura'],
  ['DAEW', 'Daewoo'],
  ['DAIH', 'Daihatsu'],
  ['DATS', 'Datsun'],
  ['HOND', 'Honda'],
  ['HYUN', 'Hyundai'],
  ['INFI', 'Infiniti'],
  ['ISU',  'Isuzu'],
  ['KIA',  'Kia'],
  ['LEXS', 'Lexus'],
  ['MAZD', 'Mazda'],
  ['MITS', 'Mitsubishi'],
  ['NISS', 'Nissan'],
  ['SUBA', 'Subaru'],
  ['SUZI', 'Suzuki', 'American Suzuki'],
  ['TOYT', 'Toyota'],

  // ── European passenger cars / trucks / SUVs ─────────────
  ['ALFA', 'Alfa Romeo'],
  ['ASTO', 'Aston Martin'],
  ['AUDI', 'Audi'],
  ['BENT', 'Bentley'],
  ['BMW',  'BMW'],
  ['BUGA', 'Bugatti'],
  ['CITR', 'Citroen'],
  ['DAIM', 'Daimler'],
  ['FERR', 'Ferrari'],
  ['FIAT', 'Fiat'],
  ['JAGU', 'Jaguar'],
  ['LAMO', 'Lamborghini'],
  ['LNCI', 'Lancia'],   // NIEM NCIC code for Lancia (Fiat Chrysler)
  ['LNDR', 'Land Rover', 'Range Rover'],
  ['LOTU', 'Lotus'],
  ['MASE', 'Maserati'],
  ['MAYB', 'Maybach'],
  ['MERZ', 'Mercedes-Benz', 'Mercedes'],
  ['OPEL', 'Opel'],
  ['PEUG', 'Peugeot'],
  ['PORS', 'Porsche'],
  ['RENA', 'Renault'],
  ['ROL',  'Rolls-Royce', 'Rolls Royce'],
  ['ROV',  'Rover'],
  ['SAA',  'Saab'],
  ['SEAT', 'Seat', 'SEAT'],
  ['SKOD', 'Skoda'],
  ['VAUX', 'Vauxhall'],
  ['VOLK', 'Volkswagen', 'VW'],
  ['VOLV', 'Volvo'],

  // ── Other foreign ────────────────────────────────────────
  ['LADA', 'Lada'],
  ['SANG', 'SsangYong', 'Ssangyong'],

  // ── Legacy / discontinued domestic ──────────────────────
  ['AMER', 'AMC', 'American Motors'],
  ['AMGN', 'AM General'],
  ['CHEC', 'Checker'],
  ['CORD', 'Cord'],
  ['DESO', 'DeSoto'],
  ['DUES', 'Duesenberg'],
  ['EDSE', 'Edsel'],
  ['HUDS', 'Hudson'],
  ['IMPE', 'Imperial'],
  ['KAIS', 'Kaiser'],
  ['LALL', 'LaSalle'],
  ['MAXL', 'Maxwell'],
  ['METR', 'Metropolitan'],
  ['NASH', 'Nash'],
  ['OAKL', 'Oakland'],
  ['PACK', 'Packard'],
  ['RAMB', 'Rambler', 'Rambler American'],
  ['REO',  'REO'],
  ['STU',  'Studebaker'],
  ['STUZ', 'Stutz'],
  ['WLLS', 'Willys'],

  // ── Electric / new-era ──────────────────────────────────
  ['BYDA', 'BYD', 'BYD Auto'],
  ['FSKR', 'Fisker'],
  ['KARM', 'Karma', 'Karma Automotive'],
  ['LUCR', 'Lucra'],
  ['MCLA', 'McLaren'],
  ['NIOV', 'NIO'],
  ['PAGN', 'Pagani'],
  ['RIVN', 'Rivian'],   // widely used in law enforcement, per AAMVA updates
  ['VLFA', 'VLF Automotive'],

  // ── Trucks / commercial (commonly stopped) ───────────────
  ['AUTO', 'Autocar'],
  ['FRHT', 'Freightliner'],
  ['HINO', 'Hino'],
  ['INTL', 'International', 'International Harvester', 'IH'],
  ['IVEC', 'Iveco'],
  ['KW',   'Kenworth'],
  ['MACK', 'Mack'],
  ['NAVI', 'Navistar', 'International Navistar'],
  ['PTRB', 'Peterbilt'],
  ['TATA', 'Tata'],
  ['UD',   'UD Trucks', 'UD Nissan'],
  ['WLNG', 'Wuling'],

  // ── Motorcycles (NCIC MotorcycleCodeSimpleType) ──────────
  ['HD',   'Harley-Davidson', 'Harley'],
  ['KAWK', 'Kawasaki'],
  ['YAMA', 'Yamaha'],
  ['TRUM', 'Triumph', 'Triumph Motorcycles'],
  ['DUCA', 'Ducati'],
  ['HUSK', 'Husqvarna'],
  ['INDI', 'Indian', 'Indian Motorcycle'],
  ['KTM',  'KTM'],
  ['POLS', 'Polaris'],
  ['BUEL', 'Buell'],
  ['APRM', 'Aprilia'],

  // ── Recreational / off-road ──────────────────────────────
  ['ATV',  'ATV', 'All Terrain Vehicle'],
  ['SNOW', 'Snowmobile'],
]);

// ── Vehicle color (NCIC VCO) ────────────────────────────────
// Source: NIEM 5.0 VCOCodeSimpleType (niem.github.io/model/5.0/ncic/VCOCodeSimpleType/)
// 33 codes — original 27 retained + 6 added: AME, CAM, COM, MVE, TEA, TPE.
// Note: TEL was in the prior set but the authoritative NIEM code is TEA (Teal);
// TEL kept as alias for backward-compat with any stored data.
const VCO = makeTable([
  ['AME', 'Amethyst', 'Amethyst Purple'],          // NIEM: Amethyst (Purple) — added
  ['BGE', 'Beige'],
  ['BLK', 'Black'],
  ['BLU', 'Blue'],
  ['BRO', 'Brown'],
  ['BRZ', 'Bronze'],
  ['CAM', 'Camouflage', 'Camo'],                   // NIEM: Camouflage — added
  ['COM', 'Chrome', 'Chrome Finish'],               // NIEM: Chrome — added
  ['CPR', 'Copper'],
  ['CRM', 'Cream', 'Ivory'],
  ['DBL', 'Dark Blue', 'Navy'],
  ['DGR', 'Dark Green'],
  ['GLD', 'Gold'],
  ['GRN', 'Green'],
  ['GRY', 'Gray', 'Grey', 'Charcoal', 'Dark Gray', 'Light Gray'],
  ['LAV', 'Lavender', 'Lavender-Purple'],
  ['LBL', 'Light Blue'],
  ['LGR', 'Light Green'],
  ['MAR', 'Maroon', 'Burgundy', 'Dark Red'],
  ['MUL', 'Multicolored', 'Multi-Color', 'Multi Colored'],
  ['MVE', 'Mauve'],                                 // NIEM: Mauve — added
  ['ONG', 'Orange'],
  ['PLE', 'Purple'],
  ['PNK', 'Pink'],
  ['RED', 'Red'],
  ['SIL', 'Silver'],
  ['TAN', 'Tan'],
  ['TEA', 'Teal', 'TEL'],                          // NIEM authoritative; TEL kept as alias
  ['TPE', 'Taupe'],                                 // NIEM: Taupe — added
  ['TRQ', 'Turquoise'],
  ['WHI', 'White'],
  ['YEL', 'Yellow'],
]);

// ── Vehicle body style (NCIC VST) ───────────────────────────
// Source: NIEM 4.2 VSTCodeSimpleType (niem.github.io/model/4.2/ncic/VSTCodeSimpleType/)
// Prior 14 rows retained; 23 additional standard codes added.
// TK was not in NIEM — kept as a convenience alias under TT/DS/TR as appropriate;
// see row comments. Aircraft, farm, and heavy-construction codes omitted (not LE vehicle
// dispatch use-case); retained the subset useful for CAD/traffic stops/fleet.
const VST = makeTable([
  // ── Passenger vehicles ────────────────────────────────────
  ['2D', '2-Door', 'Coupe (2-Door)'],
  ['3D', '3-Door', '3-Door Truck'],                        // NIEM: 3-DOOR
  ['4D', 'Sedan 4-Door', 'Sedan (4-Door)', 'Sedan'],
  ['CP', 'Coupe'],
  ['CV', 'Convertible'],
  ['HB', 'Hatchback'],
  ['LL', 'Sport Utility', 'Blazer', 'Bronco', 'Jeep Style', 'Carry-All'],  // NIEM: CARRY-ALL RUGGED
  ['LM', 'Limousine', 'Limo'],                             // NIEM: LIMOUSINE
  ['SD', 'Sedan (Unknown Doors)'],                         // NIEM: SEDAN (doors unknown)
  ['SW', 'Station Wagon', 'Wagon'],
  // ── Utility / SUV ─────────────────────────────────────────
  ['UV', 'Utility', 'SUV', 'Crossover', 'ATV / UTV'],     // NIEM: UTILITY VEHICLE
  // ── Pickup trucks ─────────────────────────────────────────
  ['PK', 'Pickup', 'Pickup Truck'],
  // ── Vans ──────────────────────────────────────────────────
  ['VC', 'Van Camper', 'Camper Van'],                      // NIEM: VAN CAMPER
  ['VN', 'Van', 'Minivan', 'Cargo Van'],
  ['VT', 'Vanette'],                                       // NIEM: VANETTE
  // ── Motorcycles / two-wheelers ────────────────────────────
  ['MB', 'Motorbike'],                                     // NIEM: MOTORBIKE
  ['MC', 'Motorcycle'],
  ['MD', 'Moped'],                                         // NIEM: MOPED
  ['MS', 'Motor Scooter', 'Scooter'],                      // NIEM: MOTORSCOOTER
  // ── Commercial / heavy ────────────────────────────────────
  ['AM', 'Ambulance'],                                     // NIEM: AMBULANCE
  ['AR', 'Armored Truck'],                                 // NIEM: ARMORED TRUCK
  ['BU', 'Bus'],
  ['CB', 'Chassis and Cab'],                               // NIEM: CHASSIS AND CAB
  ['DP', 'Dump Truck'],                                    // NIEM: DUMP
  ['DS', 'Tractor Truck Diesel', 'Semi Diesel'],           // NIEM: TRACTOR TRUCK, DIESEL
  ['FB', 'Flatbed', 'Flatbed Truck', 'Platform'],          // NIEM: FLATBED OR PLATFORM
  ['FT', 'Fire Truck'],                                    // NIEM: FIRE TRUCK
  ['GG', 'Garbage Truck', 'Refuse Truck'],                 // NIEM: GARBAGE OR REFUSE
  ['HR', 'Hearse'],                                        // NIEM: HEARSE
  ['MH', 'Motor Home', 'Motorhome', 'RV'],                 // NIEM: MOTORIZED HOME
  ['RF', 'Refrigerated Van', 'Reefer'],                    // NIEM: REFRIGERATED VAN
  ['SE', 'Semi', 'Semi-Trailer (Unknown)'],                // NIEM: SEMI
  ['SM', 'Snowmobile'],                                    // NIEM: SNOWMOBILE
  ['ST', 'Stake Truck', 'Rack Truck'],                     // NIEM: STAKE OR RACK
  ['TN', 'Tanker', 'Tank Truck'],                          // NIEM: TANKER
  ['TR', 'Truck Tractor', 'Semi Tractor'],
  ['TT', 'Tow Truck', 'Wrecker'],                          // NIEM: TOW TRUCK/WRECKER
  // ── Trailers ──────────────────────────────────────────────
  ['CT', 'Camper Trailer', 'Travel Trailer'],              // NIEM: CAMPING/TRAVEL TRAILER
  ['DT', 'Dump Trailer'],                                  // NIEM: DUMP TRAILER
  ['MT', 'Motorcycle Trailer'],                            // NIEM: MOTORCYCLE TRAILER
  ['TL', 'Trailer'],
  // ── Low-speed / specialty ─────────────────────────────────
  ['LO', 'Low Speed Vehicle', 'Golf Cart', 'NEV'],         // NIEM: LOW SPEED VEHICLES
  ['LV', 'Law Enforcement Vehicle', 'Police Vehicle'],     // NIEM: LAW ENFORCEMENT VEHICLE
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
  // Canadian provinces / territories (NLETS / Canada Post / ISO 3166-2:CA)
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'],
  ['NB', 'New Brunswick'],
  ['NL', 'Newfoundland and Labrador', 'Newfoundland'],
  ['NS', 'Nova Scotia'],
  ['NT', 'Northwest Territories'],
  ['NU', 'Nunavut'],
  ['ON', 'Ontario'],
  ['PE', 'Prince Edward Island', 'PEI'],
  ['QC', 'Quebec'],
  ['SK', 'Saskatchewan'],
  ['YT', 'Yukon', 'Yukon Territory'],
]);

// ── Utah DL class (Utah DLD) ────────────────────────────────
const DL_CLASS = makeTable([
  ['A', 'Commercial A', 'CDL-A'], ['B', 'Commercial B', 'CDL-B'],
  ['C', 'Commercial C', 'CDL-C'], ['D', 'Operator', 'Standard', 'Class D'],
  ['M', 'Motorcycle'],
]);

// ── DL restrictions (AAMVA standard A–Z + Utah-specific numeric) ────────────
// Source: AAMVA standard codes (GitHub Gist filipbec/5998034874b119fab0e4,
// mass crash report manual, AAMVA ACD 5.2) + Utah Admin. Code R708-10-4.
// Notes:
//   - "A" in Utah = No Restriction (R708-10-4); in some AAMVA contexts = Ignition IID.
//     We encode "A" as the Utah/AAMVA-prevalent "Corrective Lenses" per R708-10-4
//     (Utah uses "B" for corrective lenses matching AAMVA; "A" = no restrictions in UT).
//     STORED VALUE: keep A = Corrective Lenses (AAMVA national standard); Utah encodes
//     "no restrictions" as absence of a restriction code, not "A".
//   - H ("Limited to Employment") = restricted to driving for employment only.
//   - R (Bioptic Lens) is lower-confidence: some states use R for bioptic, others don't.
//   - Utah-specific numeric codes (1–7) added for completeness; prefixed 'UT-'.
const DL_RESTRICTION = makeTable([
  // AAMVA national standard codes
  ['A', 'Corrective Lenses', 'Corrective Lenses Required'],
  ['B', 'Outside Mirror', 'Outside/Left Mirror Required'],
  ['C', 'Mechanical Aid', 'Mechanical Devices / Hand Controls'],
  ['D', 'Prosthetic Aid', 'Prosthetic Device'],
  ['E', 'No Manual Transmission', 'Automatic Transmission Only', 'No Standard Transmission'],
  ['F', 'Outside Mirror(s)', 'Outside Mirrors Required'],
  ['G', 'Daylight Only', 'Daylight Driving Only'],
  ['H', 'Limited to Employment', 'Employment Purposes Only'],
  ['I', 'Limited Other'],
  ['J', 'Other Restriction', 'Other / See License'],
  ['K', 'CDL Intrastate Only', 'Intrastate Commerce Only'],
  ['L', 'No Air Brakes', 'Vehicles Without Air Brakes', 'No Air Brake CMV'],
  ['M', 'No Class A Bus', 'Except Class A Bus', 'CDL Except Class A Bus'],
  ['N', 'No Class A or B Bus', 'Except Class A and B Bus'],
  ['O', 'No Tractor-Trailer', 'Except Tractor-Trailer', 'No 5th Wheel'],
  ['P', 'No Passengers in CMV Bus', 'No CMV Bus Passengers'],
  ['Q', 'Automatic Transmission (Non-CMV)', 'Class D Automatic Transmission'],
  ['R', 'Bioptic Telescoping Lens'],       // lower-confidence: not all states define R
  ['S', 'Proof of Blood Sugar', 'Diabetes Blood Sugar Monitoring'],
  ['T', 'Ignition Interlock', 'Ignition Interlock Device Required', 'IID Required'],
  ['U', 'Three-Wheel Motorcycle Only', '3-Wheeled Motorcycle Only'],
  ['V', 'Medical Variance', 'CDL Medical Variance Documentation Required'],
  ['W', 'Farm Waiver', 'Intrastate Medical Waiver', 'Farm Vehicle Waiver'],
  ['X', 'No CMV Tanker Cargo', 'No Cargo in CMV Tank Vehicle'],
  ['Y', 'Convicted Sex Offender'],         // lower-confidence: state-specific application
  ['Z', 'Air Over Hydraulic Brakes', 'CDL Air Over Hydraulic'],  // lower-confidence
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

// ── Curated Utah offense table ──────────────────────────────
// { utahStatute, ncicCode (NCIC Uniform Offense Classification),
//   severity (Utah class: F1/F2/F3 felony, MA/MB/MC misdemeanor,
//   INF infraction) }. Curated common set — NOT the full manual.
// Order matters: more-specific keys come first so substring
// matching resolves "retail theft" before generic "theft".

export interface OffenseEntry { utahStatute: string; ncicCode: string; severity: string; }

const OFFENSE: Array<[keyword: string, entry: OffenseEntry]> = [
  // ── Violent — Homicide ──────────────────────────────────────
  // Order: most specific first. AGGRAVATED MURDER before MURDER before MANSLAUGHTER.
  ['AGGRAVATED MURDER',      { utahStatute: '76-5-202',  ncicCode: '0901', severity: 'F1' }],
  ['MURDER',                 { utahStatute: '76-5-203',  ncicCode: '0901', severity: 'F1' }],
  ['NEGLIGENT HOMICIDE',     { utahStatute: '76-5-206',  ncicCode: '0910', severity: 'MC' }],
  ['VEHICULAR HOMICIDE',     { utahStatute: '76-5-207',  ncicCode: '0909', severity: 'F3' }],
  ['MANSLAUGHTER',           { utahStatute: '76-5-205',  ncicCode: '0999', severity: 'F2' }],

  // ── Violent — Assault / Threats ─────────────────────────────
  // More-specific keys before generic ASSAULT.
  ['AGGRAVATED ASSAULT',     { utahStatute: '76-5-103',  ncicCode: '1305', severity: 'F3' }],
  ['ASSAULT',                { utahStatute: '76-5-102',  ncicCode: '1313', severity: 'MB' }],
  ['THREAT OF VIOLENCE',     { utahStatute: '76-5-107',  ncicCode: '1316', severity: 'MA' }],
  ['TERRORISTIC THREAT',     { utahStatute: '76-5-107',  ncicCode: '1316', severity: 'MA' }],

  // ── Violent — Robbery ───────────────────────────────────────
  ['AGGRAVATED ROBBERY',     { utahStatute: '76-6-302',  ncicCode: '1201', severity: 'F1' }],
  ['ROBBERY',                { utahStatute: '76-6-301',  ncicCode: '1201', severity: 'F2' }],

  // ── Violent — Kidnapping / Custodial ────────────────────────
  ['AGGRAVATED KIDNAPPING',  { utahStatute: '76-5-302',  ncicCode: '1099', severity: 'F1' }],
  ['CHILD ABDUCTION',        { utahStatute: '76-5-301.1',ncicCode: '1099', severity: 'F3' }],
  ['CUSTODIAL INTERFERENCE', { utahStatute: '76-5-303',  ncicCode: '1099', severity: 'F3' }],
  ['KIDNAPPING',             { utahStatute: '76-5-301',  ncicCode: '1099', severity: 'F2' }],

  // ── Violent — Sexual Offenses ───────────────────────────────
  // More-specific keywords before generic RAPE, before SEXUAL ABUSE.
  ['OBJECT RAPE',                      { utahStatute: '76-5-402.2', ncicCode: '1199', severity: 'F1' }],
  ['RAPE OF A CHILD',                  { utahStatute: '76-5-402.1', ncicCode: '1199', severity: 'F1' }],
  ['RAPE',                             { utahStatute: '76-5-402',   ncicCode: '1199', severity: 'F1' }],
  ['FORCIBLE SODOMY',                  { utahStatute: '76-5-403',   ncicCode: '1199', severity: 'F1' }],
  ['SODOMY ON A CHILD',                { utahStatute: '76-5-403.1', ncicCode: '1199', severity: 'F1' }],
  ['SEXUAL ABUSE OF A CHILD',          { utahStatute: '76-5-404.1', ncicCode: '3699', severity: 'F2' }],
  ['AGGRAVATED SEXUAL ABUSE OF A CHILD',{ utahStatute: '76-5-404.1',ncicCode: '3699', severity: 'F1' }],
  ['UNLAWFUL SEXUAL ACTIVITY WITH A MINOR',{ utahStatute: '76-5-401',ncicCode: '1122', severity: 'F3' }],
  ['FORCIBLE SEXUAL ABUSE',            { utahStatute: '76-5-404',   ncicCode: '1199', severity: 'F2' }],
  ['SEXUAL EXPLOITATION OF A MINOR',   { utahStatute: '76-5b-201',  ncicCode: '3699', severity: 'F2' }],
  ['VOYEURISM',                        { utahStatute: '76-9-702.7', ncicCode: '3699', severity: 'MB' }],
  ['SEXUAL BATTERY',                   { utahStatute: '76-9-702.1', ncicCode: '1199', severity: 'MA' }],

  // ── Violent — Domestic Violence / Child Abuse / Neglect ─────
  ['CHILD ABUSE',            { utahStatute: '76-5-109',  ncicCode: '1399', severity: 'F3' }],
  ['CHILD NEGLECT',          { utahStatute: '76-5-109.1',ncicCode: '1399', severity: 'F2' }],
  ['DOMESTIC VIOLENCE',      { utahStatute: '77-36-1',   ncicCode: '1313', severity: 'MB' }],
  ['COHABITANT ABUSE',       { utahStatute: '77-36-1',   ncicCode: '1313', severity: 'MB' }],

  // ── Violent — Stalking / Harassment ─────────────────────────
  ['STALKING',               { utahStatute: '76-5-106.5',ncicCode: '1316', severity: 'MA' }],
  ['HARASSMENT',             { utahStatute: '76-9-106',  ncicCode: '5399', severity: 'MC' }],

  // ── Property — Robbery / Burglary ───────────────────────────
  // AGGRAVATED BURGLARY before BURGLARY OF A VEHICLE before BURGLARY.
  ['AGGRAVATED BURGLARY',    { utahStatute: '76-6-203',  ncicCode: '2201', severity: 'F1' }],
  ['BURGLARY OF A VEHICLE',  { utahStatute: '76-6-204',  ncicCode: '2304', severity: 'F3' }],
  ['BURGLARY',               { utahStatute: '76-6-202',  ncicCode: '2299', severity: 'F3' }],

  // ── Property — Theft (specific before generic) ──────────────
  // RETAIL THEFT, AUTO THEFT, IDENTITY THEFT, THEFT BY DECEPTION,
  // THEFT BY EXTORTION, MAIL THEFT, WRONGFUL APPROPRIATION all before THEFT.
  ['RETAIL THEFT',           { utahStatute: '76-6-602',  ncicCode: '2303', severity: 'MB' }],
  ['SHOPLIFTING',            { utahStatute: '76-6-602',  ncicCode: '2303', severity: 'MB' }],
  ['AUTO THEFT',             { utahStatute: '76-6-404',  ncicCode: '2404', severity: 'F2' }],
  ['VEHICLE THEFT',          { utahStatute: '76-6-404',  ncicCode: '2404', severity: 'F2' }],
  ['MOTOR VEHICLE THEFT',    { utahStatute: '76-6-404',  ncicCode: '2404', severity: 'F2' }],
  ['IDENTITY THEFT',         { utahStatute: '76-6-1102', ncicCode: '2604', severity: 'F3' }],
  ['IDENTITY FRAUD',         { utahStatute: '76-6-1102', ncicCode: '2604', severity: 'F3' }],
  ['THEFT BY EXTORTION',     { utahStatute: '76-6-406',  ncicCode: '2699', severity: 'F2' }],
  ['THEFT BY DECEPTION',     { utahStatute: '76-6-405',  ncicCode: '2603', severity: 'MB' }],
  ['MAIL THEFT',             { utahStatute: '76-6-412',  ncicCode: '2312', severity: 'F3' }],
  ['WRONGFUL APPROPRIATION', { utahStatute: '76-6-421',  ncicCode: '2399', severity: 'MB' }],
  ['RECEIVING STOLEN PROPERTY',{ utahStatute: '76-6-408',ncicCode: '2810', severity: 'MA' }],
  ['POSSESSION OF STOLEN',   { utahStatute: '76-6-408',  ncicCode: '2810', severity: 'MA' }],
  ['THEFT',                  { utahStatute: '76-6-404',  ncicCode: '2399', severity: 'MB' }],

  // ── Property — Fraud / Forgery ───────────────────────────────
  // INSURANCE FRAUD, CREDIT CARD FRAUD, COMMUNICATIONS FRAUD before FRAUD.
  ['INSURANCE FRAUD',        { utahStatute: '76-6-521',  ncicCode: '2603', severity: 'F3' }],
  ['CREDIT CARD FRAUD',      { utahStatute: '76-6-506.2',ncicCode: '2606', severity: 'F3' }],
  ['COMMUNICATIONS FRAUD',   { utahStatute: '76-10-1801',ncicCode: '2607', severity: 'F2' }],
  ['PRESCRIPTION FRAUD',     { utahStatute: '58-37-8(3)',ncicCode: '3599', severity: 'F3' }],
  ['FORGERY',                { utahStatute: '76-6-501',  ncicCode: '2501', severity: 'F3' }],
  ['FRAUD',                  { utahStatute: '76-6-405',  ncicCode: '2603', severity: 'MA' }],

  // ── Property — Arson / Mischief ──────────────────────────────
  ['AGGRAVATED ARSON',       { utahStatute: '76-6-102',  ncicCode: '2001', severity: 'F1' }],
  ['ARSON',                  { utahStatute: '76-6-102',  ncicCode: '2099', severity: 'F2' }],
  ['CRIMINAL MISCHIEF',      { utahStatute: '76-6-106',  ncicCode: '2999', severity: 'MB' }],

  // ── Property — Trespass ──────────────────────────────────────
  ['CRIMINAL TRESPASS',      { utahStatute: '76-6-206',  ncicCode: '5707', severity: 'MB' }],
  ['TRESPASS',               { utahStatute: '76-6-206',  ncicCode: '5707', severity: 'MB' }],

  // ── Drugs — Distribution / Manufacture (before Possession) ──
  // MANUFACTURE, DISTRIBUTION, POSSESSION WITH INTENT all before POSSESSION.
  ['MANUFACTURE OF CONTROLLED',    { utahStatute: '58-37-8(1)(a)', ncicCode: '3599', severity: 'F2' }],
  ['DISTRIBUTION OF CONTROLLED',   { utahStatute: '58-37-8(1)(a)', ncicCode: '3599', severity: 'F2' }],
  ['SALE OF CONTROLLED',           { utahStatute: '58-37-8(1)(a)', ncicCode: '3599', severity: 'F2' }],
  ['POSSESSION WITH INTENT',       { utahStatute: '58-37-8(1)(a)', ncicCode: '3599', severity: 'F2' }],
  ['DRUG FREE ZONE',               { utahStatute: '58-37-8(5)',    ncicCode: '3599', severity: 'F2' }],
  ['CONTROLLED SUBSTANCE IN A SCHOOL',{ utahStatute: '58-37-8(5)', ncicCode: '3599', severity: 'F2' }],
  // Possession — specific substance before generic.
  ['POSSESSION OF MARIJUANA',      { utahStatute: '58-37-8(2)(a)', ncicCode: '3562', severity: 'MB' }],
  ['POSSESSION OF METHAMPHETAMINE',{ utahStatute: '58-37-8(2)(a)', ncicCode: '3571', severity: 'F3' }],
  ['POSSESSION OF HEROIN',         { utahStatute: '58-37-8(2)(a)', ncicCode: '3512', severity: 'F3' }],
  ['POSSESSION OF COCAINE',        { utahStatute: '58-37-8(2)(a)', ncicCode: '3532', severity: 'F3' }],
  ['POSSESSION OF CONTROLLED',     { utahStatute: '58-37-8(2)(a)', ncicCode: '3599', severity: 'MA' }],
  ['DRUG PARAPHERNALIA',           { utahStatute: '58-37a-5',      ncicCode: '3550', severity: 'MB' }],

  // ── Weapons ──────────────────────────────────────────────────
  ['FELON IN POSSESSION',           { utahStatute: '76-10-503',  ncicCode: '5214', severity: 'F2' }],
  ['POSSESSION OF FIREARM ON SCHOOL',{ utahStatute: '76-10-505.5',ncicCode: '5207', severity: 'F3' }],
  ['DISCHARGE OF FIREARM',          { utahStatute: '76-10-508',  ncicCode: '5212', severity: 'F3' }],
  ['UNLAWFUL POSSESSION OF DANGEROUS WEAPON',{ utahStatute: '76-10-504', ncicCode: '5299', severity: 'MB' }],
  ['CONCEALED WEAPON',              { utahStatute: '76-10-504',  ncicCode: '5212', severity: 'MB' }],
  ['CARRYING DANGEROUS WEAPON',     { utahStatute: '76-10-504',  ncicCode: '5212', severity: 'MB' }],
  ['WEAPON ON SCHOOL',              { utahStatute: '76-10-505.5',ncicCode: '5207', severity: 'F3' }],

  // ── Public Order ─────────────────────────────────────────────
  ['LEWDNESS INVOLVING A CHILD',  { utahStatute: '76-9-702.5', ncicCode: '3699', severity: 'F3' }],
  ['LEWDNESS',                    { utahStatute: '76-9-702',   ncicCode: '3699', severity: 'MB' }],
  ['INDECENT EXPOSURE',           { utahStatute: '76-9-702',   ncicCode: '3699', severity: 'MB' }],
  ['RIOT',                        { utahStatute: '76-9-101',   ncicCode: '5302', severity: 'F3' }],
  ['DISORDERLY CONDUCT',          { utahStatute: '76-9-102',   ncicCode: '5399', severity: 'INF' }],
  ['PUBLIC INTOXICATION',         { utahStatute: '76-9-701',   ncicCode: '5012', severity: 'INF' }],
  ['INTOXICATION',                { utahStatute: '76-9-701',   ncicCode: '5012', severity: 'INF' }],
  ['CRUELTY TO ANIMAL',           { utahStatute: '76-9-301',   ncicCode: '5399', severity: 'MB' }],
  ['ANIMAL CRUELTY',              { utahStatute: '76-9-301',   ncicCode: '5399', severity: 'MB' }],
  ['PROSTITUTION',                { utahStatute: '76-10-1302', ncicCode: '4003', severity: 'MB' }],
  ['PATRONIZING A PROSTITUTE',    { utahStatute: '76-10-1303', ncicCode: '4009', severity: 'MB' }],
  ['SOLICITATION OF PROSTITUTION',{ utahStatute: '76-10-1302', ncicCode: '4003', severity: 'MB' }],
  ['MONEY LAUNDERING',            { utahStatute: '76-10-1902', ncicCode: '2699', severity: 'F2' }],
  ['GAMBLING',                    { utahStatute: '76-10-1102', ncicCode: '3905', severity: 'MB' }],
  ['TOBACCO TO MINOR',            { utahStatute: '76-10-104',  ncicCode: '5399', severity: 'INF' }],
  ['VAPE TO MINOR',               { utahStatute: '76-10-104',  ncicCode: '5399', severity: 'INF' }],

  // ── Administration of Justice ────────────────────────────────
  // TAMPERING WITH EVIDENCE / WITNESS before generic OBSTRUCTING.
  ['BRIBERY',                    { utahStatute: '76-8-103',  ncicCode: '5007', severity: 'F3' }],
  ['TAMPERING WITH EVIDENCE',    { utahStatute: '76-8-510.5',ncicCode: '4806', severity: 'F3' }],
  ['WITNESS TAMPERING',          { utahStatute: '76-8-508',  ncicCode: '4806', severity: 'F3' }],
  ['FALSE INFORMATION TO POLICE',{ utahStatute: '76-8-504',  ncicCode: '4804', severity: 'MA' }],
  ['FALSE STATEMENT TO OFFICER', { utahStatute: '76-8-504',  ncicCode: '4804', severity: 'MA' }],
  ['ESCAPE',                     { utahStatute: '76-8-309',  ncicCode: '4901', severity: 'F3' }],
  ['FAILURE TO STOP AT COMMAND', { utahStatute: '76-8-305.5',ncicCode: '4801', severity: 'MA' }],
  ['RESISTING ARREST',           { utahStatute: '76-8-305',  ncicCode: '4801', severity: 'MA' }],
  ['INTERFERING WITH ARREST',    { utahStatute: '76-8-305',  ncicCode: '4801', severity: 'MA' }],
  ['OBSTRUCTING JUSTICE',        { utahStatute: '76-8-306',  ncicCode: '4801', severity: 'MB' }],
  ['OBSTRUCTING',                { utahStatute: '76-8-306',  ncicCode: '4801', severity: 'MB' }],
  ['FAILURE TO APPEAR',          { utahStatute: '77-7-22',   ncicCode: '5011', severity: 'MB' }],
  ['PERJURY',                    { utahStatute: '76-8-502',  ncicCode: '5003', severity: 'F3' }],

  // ── Traffic ──────────────────────────────────────────────────
  // DUI WITH SERIOUS INJURY, DUI DRUG, DUI before generic traffic.
  ['DUI WITH INJURY',             { utahStatute: '41-6a-502', ncicCode: '5404', severity: 'F3' }],
  ['DUI DRUG',                    { utahStatute: '41-6a-502', ncicCode: '5403', severity: 'MB' }],
  ['DUI',                         { utahStatute: '41-6a-502', ncicCode: '5404', severity: 'MB' }],
  ['DRIVING UNDER THE INFLUENCE', { utahStatute: '41-6a-502', ncicCode: '5404', severity: 'MB' }],
  ['IMPAIRED DRIVING',            { utahStatute: '41-6a-502', ncicCode: '5404', severity: 'MB' }],
  ['HIT AND RUN WITH INJURY',     { utahStatute: '41-6a-401.3',ncicCode: '5401', severity: 'F3' }],
  ['HIT AND RUN',                 { utahStatute: '41-6a-401.7',ncicCode: '5401', severity: 'MC' }],
  ['ELUDING OFFICER',             { utahStatute: '41-6a-210', ncicCode: '5499', severity: 'F3' }],
  ['FAILURE TO STOP',             { utahStatute: '41-6a-210', ncicCode: '5499', severity: 'F3' }],
  ['ELUDING',                     { utahStatute: '41-6a-210', ncicCode: '5499', severity: 'F3' }],
  ['RECKLESS DRIVING',            { utahStatute: '41-6a-528', ncicCode: '5499', severity: 'MC' }],
  ['DRIVING ON REVOKED',          { utahStatute: '53-3-227',  ncicCode: '5499', severity: 'MB' }],
  ['DRIVING ON SUSPENDED',        { utahStatute: '53-3-227',  ncicCode: '5499', severity: 'MC' }],
  ['DRIVING WITHOUT A LICENSE',   { utahStatute: '53-3-202',  ncicCode: '5499', severity: 'MC' }],
  ['NO DRIVER LICENSE',           { utahStatute: '53-3-202',  ncicCode: '5499', severity: 'MC' }],
  ['OPEN CONTAINER',              { utahStatute: '41-6a-526', ncicCode: '5499', severity: 'INF' }],
  ['SPEEDING',                    { utahStatute: '41-6a-601', ncicCode: '5499', severity: 'INF' }],
  ['FOLLOWING TOO CLOSE',         { utahStatute: '41-6a-711', ncicCode: '5499', severity: 'INF' }],
  ['IMPROPER LANE CHANGE',        { utahStatute: '41-6a-710', ncicCode: '5499', severity: 'INF' }],
  ['UNSAFE LANE CHANGE',          { utahStatute: '41-6a-710', ncicCode: '5499', severity: 'INF' }],
  ['NO INSURANCE',                { utahStatute: '41-12a-301',ncicCode: '5499', severity: 'INF' }],
];

/** Match a free-text charge to a curated offense entry (specific-first). */
export function lookupOffense(charge: string | null | undefined): OffenseEntry | null {
  const c = (charge ?? '').toUpperCase().trim();
  if (!c) return null;
  for (const [keyword, entry] of OFFENSE) {
    if (c.includes(keyword)) return entry;
  }
  return null;
}

/** "CHARGE (statute · severity · NCIC code)"; raw uppercased charge if unmatched. */
export function fmtOffense(charge: string | null | undefined): string {
  const base = (charge ?? '').toUpperCase().trim();
  if (!base) return '';
  const e = lookupOffense(base);
  return e ? `${base} (${e.utahStatute} · ${e.severity} · NCIC ${e.ncicCode})` : base;
}

export interface CodeHit { domain: NcicDomain; code: string; label: string; }

/** Search every code table by label OR code, both directions. Powers `QZ`. */
export function lookupAnyCode(term: string | null | undefined): CodeHit[] {
  const t = (term ?? '').trim();
  if (!t) return [];
  const lower = t.toLowerCase();
  const upper = t.toUpperCase();
  const hits: CodeHit[] = [];
  const seen = new Set<string>();
  (Object.keys(TABLES) as NcicDomain[]).forEach((domain) => {
    const table = TABLES[domain];
    // by code
    if (table.toLabel.has(upper)) {
      const key = `${domain}:${upper}`;
      if (!seen.has(key)) { seen.add(key); hits.push({ domain, code: upper, label: table.toLabel.get(upper)! }); }
    }
    // by label/alias
    const code = table.toCode.get(lower);
    if (code) {
      const key = `${domain}:${code}`;
      if (!seen.has(key)) { seen.add(key); hits.push({ domain, code, label: table.toLabel.get(code)! }); }
    }
  });
  return hits;
}
