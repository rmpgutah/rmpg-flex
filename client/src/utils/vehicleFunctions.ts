// ============================================================
// RMPG Flex — Shared Vehicle / Unit function library
// ============================================================
// Pure, portable functions for vehicle, plate, VIN and fleet-unit
// processing — the vehicle counterpart to dlFunctions.ts. No DOM /
// network deps, so the same logic runs on desktop and the iOS bridge.
//
// Covers: VIN validation + decode (ISO 3779 check digit, model-year
// code, WMI/country), license-plate normalisation + per-state format,
// NCIC color (VCO) and make (VMA) codes, body-style/classification,
// registration, and fleet-unit linking. Bridge: evaluateVehicle().
// ============================================================

// ── reference data ──────────────────────────────────────────

// NCIC VCO standard vehicle color codes (3-letter) → English.
export const NCIC_COLORS: Record<string, string> = {
  BLK: 'Black', BLU: 'Blue', DBL: 'Dark Blue', LBL: 'Light Blue', BRO: 'Brown',
  BGE: 'Beige', GLD: 'Gold', GRY: 'Gray', GRN: 'Green', DGR: 'Dark Green',
  LGR: 'Light Green', MAR: 'Maroon', ONG: 'Orange', PNK: 'Pink', PLE: 'Purple',
  RED: 'Red', SIL: 'Silver', TAN: 'Tan', TEA: 'Teal', WHI: 'White',
  YEL: 'Yellow', CPR: 'Copper', CRM: 'Cream', BRZ: 'Bronze', TRQ: 'Turquoise',
};

// NCIC VMA common vehicle make codes → manufacturer.
export const NCIC_MAKES: Record<string, string> = {
  FORD: 'Ford', CHEV: 'Chevrolet', GMC: 'GMC', DODG: 'Dodge', CHRY: 'Chrysler',
  JEEP: 'Jeep', RAM: 'RAM', BUIC: 'Buick', CADI: 'Cadillac', LINC: 'Lincoln',
  PONT: 'Pontiac', OLDS: 'Oldsmobile', TOYT: 'Toyota', HOND: 'Honda',
  NISS: 'Nissan', MAZD: 'Mazda', SUBA: 'Subaru', MITS: 'Mitsubishi',
  ACUR: 'Acura', LEXS: 'Lexus', INFI: 'Infiniti', HYUN: 'Hyundai', KIA: 'Kia',
  VOLK: 'Volkswagen', AUDI: 'Audi', BMW: 'BMW', MERZ: 'Mercedes-Benz',
  VOLV: 'Volvo', PORS: 'Porsche', JAGU: 'Jaguar', LNDR: 'Land Rover',
  TESL: 'Tesla', FIAT: 'Fiat', MINI: 'Mini', SATR: 'Saturn', SCIO: 'Scion',
  HUMM: 'Hummer', ISU: 'Isuzu', SUZI: 'Suzuki', GENS: 'Genesis',
};

// NCIC body-style / vehicle-style codes → English.
export const NCIC_BODY_STYLES: Record<string, string> = {
  '2D': '2-Door', '4D': '4-Door', '2C': '2-Door Convertible', CP: 'Coupe',
  SD: 'Sedan', SW: 'Station Wagon', HB: 'Hatchback', LL: 'Limousine',
  PK: 'Pickup', UT: 'Utility / SUV', VN: 'Van', MC: 'Motorcycle',
  BU: 'Bus', TR: 'Truck Tractor', TL: 'Trailer', MH: 'Motor Home',
};

// US/CA WMI country mapping by first VIN character (ISO 3780 ranges).
function wmiCountry(first: string): string {
  const c = (first || '').toUpperCase();
  if ('12345'.includes(c)) return 'United States';
  if ('JKLMNPR'.includes(c)) return 'Asia';
  if ('STUVWXYZ'.includes(c)) return 'Europe';
  if ('67'.includes(c)) return 'Oceania';
  if ('89'.includes(c)) return 'South America';
  if ('AH'.includes(c)) return 'Africa';
  return 'Unknown';
}

const VIN_TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4,
  N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

// VIN model-year code → year (position 10). The code cycles every 30 years;
// position 7 being numeric vs alpha disambiguates pre/post-2010 in practice,
// but for our fleet (modern vehicles) we resolve to the most recent plausible.
const VIN_YEAR_CODES: Record<string, number> = {
  A: 1980, B: 1981, C: 1982, D: 1983, E: 1984, F: 1985, G: 1986, H: 1987,
  J: 1988, K: 1989, L: 1990, M: 1991, N: 1992, P: 1993, R: 1994, S: 1995,
  T: 1996, V: 1997, W: 1998, X: 1999, Y: 2000,
  '1': 2001, '2': 2002, '3': 2003, '4': 2004, '5': 2005, '6': 2006, '7': 2007,
  '8': 2008, '9': 2009,
};

// US-state plate format regexes (representative; permissive where layouts vary).
export const PLATE_FORMATS: Record<string, RegExp> = {
  UT: /^[A-Z0-9]{1,7}$/, CA: /^[0-9][A-Z]{3}[0-9]{3}$/, TX: /^[A-Z]{3}[0-9]{4}$/,
  NY: /^[A-Z]{3}[0-9]{4}$/, FL: /^[A-Z0-9]{1,7}$/, AZ: /^[A-Z0-9]{1,7}$/,
  CO: /^[A-Z]{3}[0-9]{3}$/, NV: /^[0-9]{3}[A-Z]{3}$/, ID: /^[A-Z0-9]{1,7}$/,
  WY: /^[0-9]{1,2}[\s-]?[0-9]{1,5}$/, NM: /^[A-Z0-9]{1,7}$/, OR: /^[0-9]{3}[A-Z]{3}$/,
  WA: /^[A-Z0-9]{1,7}$/, MT: /^[A-Z0-9]{1,7}$/,
};

const SENTINEL = /^(none|n\/a|na|no|0|\[\]|unknown|unk)$/i;
function clean(s: string | undefined): string { const t = (s || '').trim(); return SENTINEL.test(t) ? '' : t; }

// ════════════════════════════════════════════════════════════
// 1. VIN (1–16)
// ════════════════════════════════════════════════════════════

/** 1. Strip spaces, upper-case a VIN. */
export function normalizeVin(vin: string): string { return (vin || '').replace(/\s/g, '').toUpperCase(); }

/** 2. True if a character is valid in a VIN (no I, O, Q). */
export function isVinChar(c: string): boolean { return /^[A-HJ-NPR-Z0-9]$/.test((c || '').toUpperCase()); }

/** 3. Compute the ISO-3779 check digit (position 9) for a VIN. */
export function vinCheckDigit(vin: string): string {
  const v = normalizeVin(vin);
  if (v.length !== 17) return '';
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const t = VIN_TRANSLIT[v[i]];
    if (t === undefined) return '';
    sum += t * VIN_WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

/** 4. Validate a VIN: 17 chars, legal charset, correct check digit. */
export function isValidVin(vin: string): boolean {
  const v = normalizeVin(vin);
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return false;
  const cd = vinCheckDigit(v);
  return cd !== '' && cd === v[8];
}

/** 5. World Manufacturer Identifier (positions 1–3). */
export function vinWmi(vin: string): string { return normalizeVin(vin).slice(0, 3); }

/** 6. Vehicle Descriptor Section (positions 4–8). */
export function vinVds(vin: string): string { return normalizeVin(vin).slice(3, 8); }

/** 7. Vehicle Identifier Section / serial (positions 10–17). */
export function vinSerial(vin: string): string { return normalizeVin(vin).slice(9, 17); }

/** 8. Assembly-plant code (position 11). */
export function vinPlantCode(vin: string): string { return normalizeVin(vin)[10] || ''; }

/** 9. Country/region of manufacture from the WMI. */
export function vinCountry(vin: string): string { return wmiCountry(normalizeVin(vin)[0] || ''); }

/** 10. Model year from the VIN year code (position 10), resolved to the most
 *  recent plausible year not in the future. */
export function vinModelYear(vin: string, now: Date = new Date()): number | null {
  const code = normalizeVin(vin)[9];
  const base = VIN_YEAR_CODES[code];
  if (base === undefined) return null;
  const yr = now.getUTCFullYear();
  let candidate = base;
  while (candidate + 30 <= yr + 1) candidate += 30; // roll forward through 30-yr cycle
  return candidate;
}

/** 11. The VIN year code for a given model year. */
export function vinYearCode(year: number): string {
  for (const [code, base] of Object.entries(VIN_YEAR_CODES)) if ((year - base) % 30 === 0) return code;
  return '';
}

/** 12. Loose check that a string looks like a VIN. */
export function looksLikeVin(s: string): boolean { return /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizeVin(s)); }

/** 13. Mask a VIN for display (keep WMI + last 4). */
export function maskVin(vin: string): string {
  const v = normalizeVin(vin);
  if (v.length < 8) return '•'.repeat(v.length);
  return `${v.slice(0, 3)}${'•'.repeat(v.length - 7)}${v.slice(-4)}`;
}

/** 14. Normalised equality of two VINs. */
export function vinsMatch(a: string, b: string): boolean { return !!normalizeVin(a) && normalizeVin(a) === normalizeVin(b); }

/** 15. Structured VIN decode. */
export function decodeVin(vin: string, now: Date = new Date()): {
  valid: boolean; wmi: string; vds: string; serial: string;
  country: string; modelYear: number | null; plant: string;
} {
  const v = normalizeVin(vin);
  return {
    valid: isValidVin(v), wmi: vinWmi(v), vds: vinVds(v), serial: vinSerial(v),
    country: vinCountry(v), modelYear: vinModelYear(v, now), plant: vinPlantCode(v),
  };
}

/** 16. The reason a VIN is invalid ('' if valid). */
export function vinValidationError(vin: string): string {
  const v = normalizeVin(vin);
  if (v.length !== 17) return `Length ${v.length}, expected 17`;
  if (!/^[A-HJ-NPR-Z0-9]+$/.test(v)) return 'Contains I, O, Q or other illegal characters';
  if (vinCheckDigit(v) !== v[8]) return 'Check digit mismatch';
  return '';
}

// ════════════════════════════════════════════════════════════
// 2. LICENSE PLATE (17–28)
// ════════════════════════════════════════════════════════════

/** 17. Strip spaces/dashes, upper-case a plate. */
export function normalizePlate(plate: string): string { return (plate || '').replace(/[\s-]/g, '').toUpperCase(); }

/** 18. Validate a plate against a state's format (permissive if unknown). */
export function validatePlate(state: string, plate: string): boolean {
  const pat = PLATE_FORMATS[(state || '').toUpperCase()];
  const p = normalizePlate(plate);
  if (!pat) return /^[A-Z0-9]{1,8}$/.test(p);
  return pat.test(p);
}

/** 19. Hint describing a state's plate format. */
export function plateFormatHint(state: string): string {
  const pat = PLATE_FORMATS[(state || '').toUpperCase()];
  return pat ? pat.source : 'No published format';
}

/** 20. Normalised equality of two plates. */
export function platesMatch(a: string, b: string): boolean { return !!normalizePlate(a) && normalizePlate(a) === normalizePlate(b); }

/** 21. Mask a plate for display (keep first + last). */
export function maskPlate(plate: string): string {
  const p = normalizePlate(plate);
  if (p.length <= 2) return '••';
  return `${p[0]}${'•'.repeat(p.length - 2)}${p.slice(-1)}`;
}

/** 22. Loose check that a string looks like a plate. */
export function looksLikePlate(s: string): boolean { return /^[A-Z0-9]{2,8}$/.test(normalizePlate(s)); }

/** 23. Format a plate for readable display (space the letter/number boundary). */
export function formatPlate(plate: string): string {
  const p = normalizePlate(plate);
  return p.replace(/([A-Z]+)(\d+)/, '$1 $2').replace(/(\d+)([A-Z]+)/, '$1 $2');
}

/** 24. States whose format a given plate could match. */
export function candidateStatesForPlate(plate: string): string[] {
  const p = normalizePlate(plate);
  if (!p) return [];
  return Object.entries(PLATE_FORMATS).filter(([, pat]) => pat.test(p)).map(([st]) => st);
}

/** 25. Heuristic: is this likely a vanity/personalised plate? */
export function isLikelyVanityPlate(plate: string): boolean {
  const p = normalizePlate(plate);
  return p.length >= 2 && /^[A-Z0-9]+$/.test(p) && !/\d{3,}/.test(p) && /[A-Z]/.test(p) && p.length <= 7 && !/^\d/.test(p) && /[A-Z]{3,}/.test(p);
}

/** 26. Plate character count. */
export function plateLength(plate: string): number { return normalizePlate(plate).length; }

/** 27. Plate digits-only? */
export function isNumericPlate(plate: string): boolean { return /^\d+$/.test(normalizePlate(plate)); }

/** 28. Strip a state prefix from a "UT-ABC123" style combined string → {state, plate}. */
export function splitStatePlate(combined: string): { state: string; plate: string } {
  const m = (combined || '').trim().toUpperCase().match(/^([A-Z]{2})[\s-]+([A-Z0-9-]+)$/);
  return m ? { state: m[1], plate: normalizePlate(m[2]) } : { state: '', plate: normalizePlate(combined) };
}

// ════════════════════════════════════════════════════════════
// 3. NCIC COLOR & MAKE CODES (29–40)
// ════════════════════════════════════════════════════════════

/** 29. Expand an NCIC color code → English. */
export function expandColorCode(code: string): string { return NCIC_COLORS[(code || '').toUpperCase()] || clean(code); }

/** 30. NCIC color code from an English name. */
export function colorCodeFromName(name: string): string {
  const n = (name || '').trim().toLowerCase();
  for (const [code, eng] of Object.entries(NCIC_COLORS)) if (eng.toLowerCase() === n) return code;
  return '';
}

/** 31. True if a color code is a recognised NCIC code. */
export function isValidColorCode(code: string): boolean { return !!NCIC_COLORS[(code || '').toUpperCase()]; }

/** 32. Parse a two-tone color ("BLK/WHI") into [top, bottom] English names. */
export function parseTwoToneColor(s: string): string[] {
  return (s || '').split('/').map(c => expandColorCode(c.trim())).filter(Boolean);
}

/** 33. Expand an NCIC make code → manufacturer. */
export function expandMakeCode(code: string): string { return NCIC_MAKES[(code || '').toUpperCase()] || clean(code); }

/** 34. NCIC make code from a manufacturer name. */
export function makeCodeFromName(name: string): string {
  const n = (name || '').trim().toLowerCase();
  for (const [code, eng] of Object.entries(NCIC_MAKES)) if (eng.toLowerCase() === n) return code;
  return '';
}

/** 35. True if a make code is a recognised NCIC code. */
export function isValidMakeCode(code: string): boolean { return !!NCIC_MAKES[(code || '').toUpperCase()]; }

/** 36. Expand an NCIC body-style code → English. */
export function expandBodyStyle(code: string): string { return NCIC_BODY_STYLES[(code || '').toUpperCase()] || clean(code); }

/** 37. True if a body-style code is recognised. */
export function isValidBodyStyle(code: string): boolean { return !!NCIC_BODY_STYLES[(code || '').toUpperCase()]; }

/** 38. All known NCIC color codes. */
export function allColorCodes(): string[] { return Object.keys(NCIC_COLORS); }

/** 39. All known NCIC make codes. */
export function allMakeCodes(): string[] { return Object.keys(NCIC_MAKES); }

/** 40. Normalise a free-form make ('toyota'/'TOYT'/'Toyota') → canonical name. */
export function normalizeMake(input: string): string {
  const s = (input || '').trim();
  if (NCIC_MAKES[s.toUpperCase()]) return NCIC_MAKES[s.toUpperCase()];
  const code = makeCodeFromName(s);
  return code ? NCIC_MAKES[code] : s;
}

// ════════════════════════════════════════════════════════════
// 4. CLASSIFICATION & REGISTRATION (41–52)
// ════════════════════════════════════════════════════════════

/** 41. Vehicle age in years from model year. */
export function vehicleAge(modelYear: number, now: Date = new Date()): number | null {
  if (!modelYear || modelYear < 1900) return null;
  return Math.max(0, now.getUTCFullYear() - modelYear);
}

/** 42. True if a classic/antique vehicle (25+ years). */
export function isClassicVehicle(modelYear: number, now?: Date): boolean { const a = vehicleAge(modelYear, now); return a !== null && a >= 25; }

/** 43. True if a body-style code denotes a commercial vehicle. */
export function isCommercialBodyStyle(code: string): boolean { return ['TR', 'TL', 'BU', 'PK', 'VN'].includes((code || '').toUpperCase()); }

/** 44. True if a body-style code denotes a motorcycle. */
export function isMotorcycleBodyStyle(code: string): boolean { return (code || '').toUpperCase() === 'MC'; }

/** 45. Registration expired? (ISO expiry vs now.) */
export function isRegistrationExpired(expiryIso: string, now: Date = new Date()): boolean {
  const m = (expiryIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** 46. Days until registration expiry (negative if past), or null. */
export function daysUntilRegistrationExpiry(expiryIso: string, now: Date = new Date()): number | null {
  const m = (expiryIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - today) / 86_400_000);
}

/** 47. Registration status label. */
export function registrationStatus(expiryIso: string, soonDays = 30, now?: Date): string {
  const n = daysUntilRegistrationExpiry(expiryIso, now);
  if (n === null) return 'unknown';
  if (n < 0) return 'expired';
  if (n <= soonDays) return 'expiring';
  return 'valid';
}

/** 48. One-line vehicle descriptor ("2019 Silver Toyota Sedan"). */
export function vehicleDescriptor(year: number | string, color: string, make: string, body: string): string {
  return [year || '', expandColorCode(color), expandMakeCode(make) || normalizeMake(make), expandBodyStyle(body)]
    .map(x => String(x).trim()).filter(Boolean).join(' ');
}

/** 49. True if model year is plausible (1900..now+2). */
export function isPlausibleModelYear(year: number, now: Date = new Date()): boolean {
  return year >= 1900 && year <= now.getUTCFullYear() + 2;
}

/** 50. Coarse vehicle category from body style. */
export function vehicleCategory(body: string): string {
  const c = (body || '').toUpperCase();
  if (isMotorcycleBodyStyle(c)) return 'motorcycle';
  if (['TR', 'TL', 'BU'].includes(c)) return 'heavy';
  if (['PK', 'VN', 'UT'].includes(c)) return 'light truck';
  if (['MH'].includes(c)) return 'rv';
  return 'passenger';
}

/** 51. Model year decade label ('2010s'). */
export function modelYearDecade(year: number): string { return year >= 1900 ? `${Math.floor(year / 10) * 10}s` : ''; }

/** 52. Does the VIN's decoded year match the stated registration year? */
export function vinYearMatchesStated(vin: string, statedYear: number, now?: Date): boolean {
  const y = vinModelYear(vin, now);
  return y !== null && y === statedYear;
}

// ════════════════════════════════════════════════════════════
// 5. FLEET UNIT LINKING (53–60)
// ════════════════════════════════════════════════════════════

/** 53. Normalise a unit id ('unit 12' / 'U-12' / '12') → '12'. */
export function normalizeUnitId(unit: string): string {
  return (unit || '').replace(/^(unit|u|car|veh)[\s-]*/i, '').replace(/[\s-]/g, '').toUpperCase();
}

/** 54. Format a unit id for display ('UNIT 12'). */
export function formatUnitId(unit: string): string { const u = normalizeUnitId(unit); return u ? `UNIT ${u}` : ''; }

/** 55. Normalised equality of two unit ids. */
export function unitsMatch(a: string, b: string): boolean { return !!normalizeUnitId(a) && normalizeUnitId(a) === normalizeUnitId(b); }

/** 56. True if a unit id is structurally valid (alnum, 1–6 chars). */
export function isValidUnitId(unit: string): boolean { return /^[A-Z0-9]{1,6}$/.test(normalizeUnitId(unit)); }

/** 57. Build a fleet-vehicle label ("UNIT 12 — 2019 Ford UT-ABC123"). */
export function fleetVehicleLabel(unit: string, year: number | string, make: string, state: string, plate: string): string {
  const parts = [formatUnitId(unit), [year, expandMakeCode(make) || make].filter(Boolean).join(' '),
    [state && state.toUpperCase(), normalizePlate(plate)].filter(Boolean).join('-')];
  return parts.filter(Boolean).join(' — ');
}

/** 58. Parse a combined "12:UT-ABC123" unit↔plate token. */
export function parseUnitPlate(token: string): { unit: string; state: string; plate: string } {
  const [u, rest] = (token || '').split(':');
  const sp = splitStatePlate(rest || '');
  return { unit: normalizeUnitId(u || ''), state: sp.state, plate: sp.plate };
}

/** 59. True if a stolen-list plate/VIN matches a queried vehicle (either key). */
export function matchesStolenVehicle(query: { plate?: string; vin?: string }, record: { plate?: string; vin?: string }): boolean {
  if (query.vin && record.vin && vinsMatch(query.vin, record.vin)) return true;
  if (query.plate && record.plate && platesMatch(query.plate, record.plate)) return true;
  return false;
}

/** 60. Short stolen-check key for a vehicle (VIN preferred, else plate). */
export function vehicleKey(v: { plate?: string; vin?: string; state?: string }): string {
  if (v.vin && looksLikeVin(v.vin)) return `VIN:${normalizeVin(v.vin)}`;
  if (v.plate) return `PLATE:${(v.state || '').toUpperCase()}:${normalizePlate(v.plate)}`;
  return '';
}

// ════════════════════════════════════════════════════════════
// 6. BRIDGE (61)
// ════════════════════════════════════════════════════════════

export interface VehicleInput {
  vin?: string; plate?: string; state?: string; year?: number | string;
  color?: string; make?: string; body_style?: string; registration_expiry?: string;
  is_stolen?: boolean; unit_id?: string;
}

export interface VehicleEvaluation {
  vinValid: boolean;
  vinError: string;
  decodedYear: number | null;
  yearMatches: boolean | null;
  plateValid: boolean;
  plateState: string;
  color: string;
  make: string;
  bodyStyle: string;
  category: string;
  age: number | null;
  classic: boolean;
  registration: string;
  stolen: boolean;
  descriptor: string;
  unitLabel: string;
  key: string;
}

/**
 * 61. Single bridge entry point — desktop and iOS both call this to derive
 * the full vehicle intelligence set from one input object.
 */
export function evaluateVehicle(v: VehicleInput, now: Date = new Date()): VehicleEvaluation {
  const decodedYear = v.vin ? vinModelYear(v.vin, now) : null;
  const statedYear = typeof v.year === 'string' ? parseInt(v.year, 10) : v.year;
  return {
    vinValid: v.vin ? isValidVin(v.vin) : false,
    vinError: v.vin ? vinValidationError(v.vin) : '',
    decodedYear,
    yearMatches: v.vin && statedYear ? vinYearMatchesStated(v.vin, statedYear, now) : null,
    plateValid: v.plate ? validatePlate(v.state || '', v.plate) : false,
    plateState: (v.state || '').toUpperCase(),
    color: expandColorCode(v.color || ''),
    make: expandMakeCode(v.make || '') || normalizeMake(v.make || ''),
    bodyStyle: expandBodyStyle(v.body_style || ''),
    category: vehicleCategory(v.body_style || ''),
    age: statedYear ? vehicleAge(statedYear, now) : (decodedYear ? vehicleAge(decodedYear, now) : null),
    classic: isClassicVehicle(statedYear || decodedYear || 0, now),
    registration: registrationStatus(v.registration_expiry || '', 30, now),
    stolen: !!v.is_stolen,
    descriptor: vehicleDescriptor(v.year || decodedYear || '', v.color || '', v.make || '', v.body_style || ''),
    unitLabel: v.unit_id ? formatUnitId(v.unit_id) : '',
    key: vehicleKey(v),
  };
}
