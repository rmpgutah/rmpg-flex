// ============================================================
// RMPG Flex — Shared Driver's License function library
// ============================================================
// 100 pure, portable functions for driver's-license processing.
//
// PORTABILITY: every function here is a pure function of its inputs with
// NO DOM, network, or React dependency, so the exact same logic runs in
// the desktop React app AND in the iOS app's JS bridge (the iOS scanner
// posts AAMVA payloads to a WebView/JSCore context that imports this
// module — see `evaluateDl` for the single-call bridge entry point).
//
// Grouped: jurisdiction · DL-number format · dates · age/eligibility ·
// physical descriptors · class/restriction/endorsement codes · REAL ID /
// compliance · validation/quality · safety summary · bridge.
// ============================================================

import {
  IIN_TO_STATE, RESTRICTION_CODES, ENDORSEMENT_CODES, CLASS_CODES,
  type AamvaResult,
} from './aamvaParser';

// ── reference data ──────────────────────────────────────────

export const JURISDICTION_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  GU: 'Guam', PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', AS: 'American Samoa',
  // Canadian provinces (AAMVA participants)
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', ON: 'Ontario',
  PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan',
};

const US_TERRITORIES = new Set(['GU', 'PR', 'VI', 'AS', 'MP']);
const CA_PROVINCES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK', 'NT', 'NU', 'YT']);

// AAMVA-published per-jurisdiction DL-number format regexes (US states + DC).
// Source: AAMVA DL/ID format catalogue. Patterns are deliberately permissive
// where a state allows multiple layouts.
export const DL_FORMATS: Record<string, RegExp> = {
  AL: /^\d{1,8}$/, AK: /^\d{1,7}$/, AZ: /^([A-Z]\d{8}|\d{9})$/, AR: /^\d{4,9}$/,
  CA: /^[A-Z]\d{7}$/, CO: /^(\d{9}|[A-Z]\d{3,6}|[A-Z]{2}\d{2,5})$/, CT: /^\d{9}$/,
  DE: /^\d{1,7}$/, DC: /^(\d{7}|\d{9})$/, FL: /^[A-Z]\d{12}$/, GA: /^\d{7,9}$/,
  HI: /^([A-Z]\d{8}|\d{9})$/, ID: /^([A-Z]{2}\d{6}[A-Z]|\d{9})$/, IL: /^[A-Z]\d{11,12}$/,
  IN: /^([A-Z]\d{9}|\d{9,10})$/, IA: /^(\d{9}|\d{3}[A-Z]{2}\d{4})$/, KS: /^([A-Z]\d{8}|\d{9})$/,
  KY: /^([A-Z]\d{8,9}|\d{9})$/, LA: /^\d{1,9}$/, ME: /^(\d{7,8}|\d{7}[A-Z])$/,
  MD: /^[A-Z]\d{12}$/, MA: /^([A-Z]\d{8}|\d{9})$/, MI: /^([A-Z]\d{10,12})$/,
  MN: /^[A-Z]\d{12}$/, MS: /^\d{9}$/, MO: /^([A-Z]\d{5,9}|\d{8,9}|[A-Z]\d{6}R)$/,
  MT: /^([A-Z]\d{8}|\d{9,14})$/, NE: /^([A-Z]\d{6,8})$/, NV: /^(\d{9,10}|\d{12}|X\d{8})$/,
  NH: /^\d{2}[A-Z]{3}\d{5}$/, NJ: /^[A-Z]\d{14}$/, NM: /^\d{8,9}$/, NY: /^(\d{9}|[A-Z]\d{18}|\d{16}|[A-Z]{8})$/,
  NC: /^\d{1,12}$/, ND: /^([A-Z]{3}\d{6}|\d{9})$/, OH: /^([A-Z]\d{4,8}|[A-Z]{2}\d{3,7}|\d{8})$/,
  OK: /^([A-Z]\d{9}|\d{9})$/, OR: /^(\d{1,9}|[A-Z]\d{6})$/, PA: /^\d{8}$/, RI: /^([A-Z]\d{6}|\d{7})$/,
  SC: /^\d{5,11}$/, SD: /^(\d{6,10}|\d{12})$/, TN: /^\d{7,9}$/, TX: /^\d{7,8}$/, UT: /^\d{4,10}$/,
  VT: /^(\d{8}|\d{7}[A-Z])$/, VA: /^([A-Z]\d{8,11}|\d{9})$/, WA: /^([A-Z]{1,7}[A-Z0-9*]{4,11})$/,
  WV: /^(\d{7}|[A-Z]{1,2}\d{5,6})$/, WI: /^[A-Z]\d{13}$/, WY: /^\d{9,10}$/,
};

const EYE_NAMES: Record<string, string> = {
  BLK: 'Black', BLU: 'Blue', BRO: 'Brown', BRN: 'Brown', GRY: 'Gray', GRN: 'Green',
  HAZ: 'Hazel', MAR: 'Maroon', PNK: 'Pink', DIC: 'Dichromatic', UNK: 'Unknown',
};
const HAIR_NAMES: Record<string, string> = {
  BAL: 'Bald', BLK: 'Black', BLN: 'Blond', BRO: 'Brown', BRN: 'Brown', GRY: 'Gray',
  RED: 'Red', SDY: 'Sandy', WHI: 'White', UNK: 'Unknown',
};

const SENTINEL = /^(none|n\/a|na|no|0|\[\]|unknown|unavl|unavailable)$/i;

// ════════════════════════════════════════════════════════════
// 1. JURISDICTION & IIN (1–14)
// ════════════════════════════════════════════════════════════

/** 1. AAMVA 6-digit IIN → 2-letter jurisdiction (''. if unknown). */
export function iinToState(iin: string): string { return IIN_TO_STATE[(iin || '').trim()] || ''; }

/** 2. Jurisdiction code → its AAMVA IIN ('' if unknown). */
export function stateToIin(state: string): string {
  const s = normalizeJurisdiction(state);
  for (const [iin, st] of Object.entries(IIN_TO_STATE)) if (st === s) return iin;
  return '';
}

/** 3. True if the code is a Canadian province. */
export function isCanadianJurisdiction(state: string): boolean { return CA_PROVINCES.has(normalizeJurisdiction(state)); }

/** 4. True if the code is a US state or DC. */
export function isUSState(state: string): boolean {
  const s = normalizeJurisdiction(state);
  return !!JURISDICTION_NAMES[s] && !CA_PROVINCES.has(s) && !US_TERRITORIES.has(s);
}

/** 5. True if the code is a US territory. */
export function isUSTerritory(state: string): boolean { return US_TERRITORIES.has(normalizeJurisdiction(state)); }

/** 6. Full jurisdiction name from its code. */
export function jurisdictionName(state: string): string { return JURISDICTION_NAMES[normalizeJurisdiction(state)] || ''; }

/** 7. All known jurisdiction codes. */
export function allJurisdictions(): string[] { return Object.keys(JURISDICTION_NAMES); }

/** 8. True if `state` is a recognised AAMVA jurisdiction code. */
export function isValidJurisdictionCode(state: string): boolean { return !!JURISDICTION_NAMES[normalizeJurisdiction(state)]; }

/** 9. Issuing country inferred from an IIN ('USA' | 'CAN' | ''). */
export function iinIssuerCountry(iin: string): string {
  const st = iinToState(iin);
  if (!st) return '';
  return CA_PROVINCES.has(st) ? 'CAN' : 'USA';
}

/** 10. Normalise free-form jurisdiction input ('Utah'/'ut'/' UT ') → 'UT'. */
export function normalizeJurisdiction(input: string): string {
  const s = (input || '').trim();
  if (!s) return '';
  const up = s.toUpperCase();
  if (JURISDICTION_NAMES[up]) return up;
  for (const [code, name] of Object.entries(JURISDICTION_NAMES)) if (name.toUpperCase() === up) return code;
  return up.slice(0, 2);
}

/** 11. Country of a jurisdiction code ('USA' | 'CAN' | ''). */
export function jurisdictionCountry(state: string): string {
  const s = normalizeJurisdiction(state);
  if (!JURISDICTION_NAMES[s]) return '';
  return CA_PROVINCES.has(s) ? 'CAN' : 'USA';
}

/** 12. True if two jurisdiction inputs refer to the same place. */
export function sameJurisdiction(a: string, b: string): boolean {
  return !!normalizeJurisdiction(a) && normalizeJurisdiction(a) === normalizeJurisdiction(b);
}

/** 13. True if the IIN string is structurally a valid AAMVA IIN (6 digits). */
export function isValidIin(iin: string): boolean { return /^\d{6}$/.test((iin || '').trim()); }

/** 14. Count of distinct jurisdictions in the registry. */
export function jurisdictionCount(): number { return Object.keys(JURISDICTION_NAMES).length; }

// ════════════════════════════════════════════════════════════
// 2. DL-NUMBER FORMAT (15–26)
// ════════════════════════════════════════════════════════════

/** 15. Strip spaces/dashes and upper-case a DL number. */
export function normalizeDlNumber(dl: string): string { return (dl || '').replace(/[\s-]/g, '').toUpperCase(); }

/** 16. Validate a DL number against its jurisdiction's AAMVA format. */
export function validateDlNumber(state: string, dl: string): boolean {
  const pat = DL_FORMATS[normalizeJurisdiction(state)];
  if (!pat) return normalizeDlNumber(dl).length >= 1; // unknown jurisdiction → permissive
  return pat.test(normalizeDlNumber(dl));
}

/** 17. Human hint describing a jurisdiction's DL format. */
export function dlNumberFormatHint(state: string): string {
  const pat = DL_FORMATS[normalizeJurisdiction(state)];
  return pat ? pat.source : 'No published format';
}

/** 18. True if the jurisdiction's DL numbers are digits only. */
export function isNumericOnlyDl(state: string): boolean {
  const pat = DL_FORMATS[normalizeJurisdiction(state)];
  return !!pat && !/[A-Z]/.test(pat.source);
}

/** 19. Normalised equality of two DL numbers. */
export function dlNumbersMatch(a: string, b: string): boolean {
  return !!normalizeDlNumber(a) && normalizeDlNumber(a) === normalizeDlNumber(b);
}

/** 20. Mask a DL number for display (keep first 2 + last 2). */
export function maskDlNumber(dl: string): string {
  const n = normalizeDlNumber(dl);
  if (n.length <= 4) return '••••';
  return `${n.slice(0, 2)}${'•'.repeat(Math.max(2, n.length - 4))}${n.slice(-2)}`;
}

/** 21. Loose check that a string looks like a DL number at all. */
export function looksLikeDlNumber(s: string): boolean {
  const n = normalizeDlNumber(s);
  return /^[A-Z0-9*]{4,20}$/.test(n);
}

/** 22. Expected length range of a jurisdiction's DL number, or null. */
export function dlNumberLengthRange(state: string): { min: number; max: number } | null {
  const sample = DL_FORMATS[normalizeJurisdiction(state)];
  if (!sample) return null;
  // Derive a coarse range from the longest literal alternative in the pattern.
  const src = sample.source.replace(/[$^]/g, '');
  const m = src.match(/\{(\d+),?(\d+)?\}/g) || [];
  let min = 0, max = 0;
  for (const q of m) {
    const [a, b] = q.replace(/[{}]/g, '').split(',');
    min += Number(a); max += Number(b || a);
  }
  return { min: min || 1, max: max || 20 };
}

/** 23. Format a DL number for readable display in groups of 3. */
export function formatDlNumber(dl: string): string {
  const n = normalizeDlNumber(dl);
  return n.replace(/(.{3})/g, '$1 ').trim();
}

/** 24. Is the DL number plausibly a temporary/duplicate marker (ends with letter)? */
export function isDlNumberSuffixed(dl: string): boolean { return /[A-Z]$/.test(normalizeDlNumber(dl)); }

/** 25. Validate a DL number where the jurisdiction is unknown (any plausible). */
export function validateDlNumberLoose(dl: string): boolean { return looksLikeDlNumber(dl); }

/** 26. Which jurisdictions' formats a given DL number could match. */
export function candidateJurisdictionsForDl(dl: string): string[] {
  const n = normalizeDlNumber(dl);
  if (!n) return [];
  return Object.entries(DL_FORMATS).filter(([, pat]) => pat.test(n)).map(([st]) => st);
}

// ════════════════════════════════════════════════════════════
// 3. DATES (27–42)
// ════════════════════════════════════════════════════════════

/** 27. Parse an ISO 'YYYY-MM-DD' to a Date (UTC midnight) or null. */
export function parseIsoDate(iso: string): Date | null {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** 28. True if a string is a valid ISO date. */
export function isValidIsoDate(iso: string): boolean { return parseIsoDate(iso) !== null; }

/** 29. Whole days between two ISO dates (b - a). */
export function daysBetweenIso(a: string, b: string): number | null {
  const da = parseIsoDate(a), db = parseIsoDate(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/** 30. True if an expiry ISO date is in the past (relative to `now`). */
export function isExpired(expiryIso: string, now: Date = new Date()): boolean {
  const d = parseIsoDate(expiryIso);
  return !!d && d.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** 31. Days until an expiry (negative if past), or null. */
export function daysUntilExpiry(expiryIso: string, now: Date = new Date()): number | null {
  const d = parseIsoDate(expiryIso);
  if (!d) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d.getTime() - today) / 86_400_000);
}

/** 32. True if the license expires within `days` (and not already expired). */
export function isExpiringSoon(expiryIso: string, days = 30, now: Date = new Date()): boolean {
  const n = daysUntilExpiry(expiryIso, now);
  return n !== null && n >= 0 && n <= days;
}

/** 33. 'expired' | 'expiring' | 'valid' | 'unknown'. */
export function expiryStatus(expiryIso: string, soonDays = 30, now: Date = new Date()): string {
  const n = daysUntilExpiry(expiryIso, now);
  if (n === null) return 'unknown';
  if (n < 0) return 'expired';
  if (n <= soonDays) return 'expiring';
  return 'valid';
}

/** 34. Format an ISO date as MM/DD/YYYY. */
export function formatDateUS(iso: string): string {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (iso || '');
}

/** 35. Format an ISO date long ('January 15, 1985'). */
export function formatDateLong(iso: string): string {
  const d = parseIsoDate(iso);
  if (!d) return iso || '';
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** 36. AAMVA date (CCYYMMDD or MMDDCCYY) → ISO. US default MMDDCCYY. */
export function aamvaDateToIso(v: string, usFormat = true): string {
  const s = (v || '').replace(/\D/g, '');
  if (s.length !== 8) return '';
  const [a, b, c, d] = [s.slice(0, 2), s.slice(2, 4), s.slice(4, 8), s.slice(0, 4)];
  if (usFormat && +a <= 12) return `${c}-${a}-${b}`;
  return `${d}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** 37. ISO date → AAMVA CCYYMMDD. */
export function isoToAamvaDate(iso: string): string {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}

/** 38. Add whole years to an ISO date. */
export function addYearsIso(iso: string, years: number): string {
  const d = parseIsoDate(iso);
  if (!d) return '';
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** 39. Today as ISO (UTC). */
export function todayIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
}

/** 40. True if two ISO dates are the same calendar day. */
export function isSameIsoDay(a: string, b: string): boolean { return !!parseIsoDate(a) && a === b; }

/** 41. Clamp/validate a year is plausible for a license (1900..now+20). */
export function isPlausibleYear(year: number, now: Date = new Date()): boolean {
  return year >= 1900 && year <= now.getUTCFullYear() + 20;
}

/** 42. Most-recent of a list of ISO dates. */
export function latestIsoDate(dates: string[]): string {
  return dates.filter(isValidIsoDate).sort().slice(-1)[0] || '';
}

// ════════════════════════════════════════════════════════════
// 4. AGE & ELIGIBILITY (43–58)
// ════════════════════════════════════════════════════════════

/** 43. Age in whole years from a DOB ISO on a given date. */
export function ageFromDob(dobIso: string, on: Date = new Date()): number | null {
  const d = parseIsoDate(dobIso);
  if (!d) return null;
  let age = on.getUTCFullYear() - d.getUTCFullYear();
  const had = on.getUTCMonth() > d.getUTCMonth() || (on.getUTCMonth() === d.getUTCMonth() && on.getUTCDate() >= d.getUTCDate());
  if (!had) age--;
  return age < 0 || age > 130 ? null : age;
}

/** 44. True if the subject is 18+. */
export function isAdult(dobIso: string, on?: Date): boolean { const a = ageFromDob(dobIso, on); return a !== null && a >= 18; }

/** 45. True if the subject is a minor (<18). */
export function isMinor(dobIso: string, on?: Date): boolean { const a = ageFromDob(dobIso, on); return a !== null && a < 18; }

/** 46. True if the subject is under 21. */
export function isUnder21(dobIso: string, on?: Date): boolean { const a = ageFromDob(dobIso, on); return a !== null && a < 21; }

/** 47. True if of legal drinking age (21+). */
export function isOfDrinkingAge(dobIso: string, on?: Date): boolean { const a = ageFromDob(dobIso, on); return a !== null && a >= 21; }

/** 48. True if of voting age (18+). */
export function isOfVotingAge(dobIso: string, on?: Date): boolean { return isAdult(dobIso, on); }

/** 49. True if old enough to rent a car without surcharge (25+). */
export function canRentCarStandard(dobIso: string, on?: Date): boolean { const a = ageFromDob(dobIso, on); return a !== null && a >= 25; }

/** 50. True if a senior driver (65+). */
export function isSeniorDriver(dobIso: string, on?: Date): boolean { const a = ageFromDob(dobIso, on); return a !== null && a >= 65; }

/** 51. Coarse age bracket label. */
export function ageBracket(dobIso: string, on?: Date): string {
  const a = ageFromDob(dobIso, on);
  if (a === null) return 'unknown';
  if (a < 16) return 'under 16';
  if (a < 18) return '16-17';
  if (a < 21) return '18-20';
  if (a < 25) return '21-24';
  if (a < 65) return '25-64';
  return '65+';
}

/** 52. The ISO date the subject turns `target` years old. */
export function dateOfAge(dobIso: string, target: number): string { return addYearsIso(dobIso, target); }

/** 53. ISO date the subject turns 21. */
export function turns21Iso(dobIso: string): string { return addYearsIso(dobIso, 21); }

/** 54. ISO date the subject turns 18. */
export function turns18Iso(dobIso: string): string { return addYearsIso(dobIso, 18); }

/** 55. True if it's the subject's birthday on `on`. */
export function isBirthday(dobIso: string, on: Date = new Date()): boolean {
  const d = parseIsoDate(dobIso);
  return !!d && d.getUTCMonth() === on.getUTCMonth() && d.getUTCDate() === on.getUTCDate();
}

/** 56. Days until the subject's next birthday. */
export function daysUntilBirthday(dobIso: string, on: Date = new Date()): number | null {
  const d = parseIsoDate(dobIso);
  if (!d) return null;
  const yr = on.getUTCFullYear();
  let next = Date.UTC(yr, d.getUTCMonth(), d.getUTCDate());
  const today = Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate());
  if (next < today) next = Date.UTC(yr + 1, d.getUTCMonth(), d.getUTCDate());
  return Math.round((next - today) / 86_400_000);
}

/** 57. True if subject likely subject to graduated-license rules (<18). */
export function isGraduatedLicenseAge(dobIso: string, on?: Date): boolean { return isMinor(dobIso, on); }

/** 58. Eligibility flags as a map for a subject. */
export function eligibilityFlags(dobIso: string, on?: Date): Record<string, boolean> {
  return {
    adult: isAdult(dobIso, on), minor: isMinor(dobIso, on), under21: isUnder21(dobIso, on),
    drinking: isOfDrinkingAge(dobIso, on), voting: isOfVotingAge(dobIso, on),
    rentCar: canRentCarStandard(dobIso, on), senior: isSeniorDriver(dobIso, on),
  };
}

// ════════════════════════════════════════════════════════════
// 5. PHYSICAL DESCRIPTORS (59–72)
// ════════════════════════════════════════════════════════════

/** 59. Parse a height string ("5'10\"", "070 in", "178 cm", "510") → inches. */
export function heightToInches(h: string): number | null {
  const s = (h || '').trim().toUpperCase();
  if (!s) return null;
  let m = s.match(/^(\d)'(\d{1,2})"?$/); if (m) return +m[1] * 12 + +m[2];
  m = s.match(/^(\d+)\s*CM$/); if (m) return Math.round(+m[1] / 2.54);
  m = s.match(/^(\d+)\s*IN$/); if (m) return +m[1];
  m = s.match(/^(\d{3})$/); if (m && +m[1] >= 400 && +m[1] <= 711 && +m[1] % 100 <= 11) return Math.floor(+m[1] / 100) * 12 + (+m[1] % 100);
  m = s.match(/^(\d+)$/); if (m) return +m[1] > 100 ? Math.round(+m[1] / 2.54) : +m[1];
  return null;
}

/** 60. Inches → `F'II"`. */
export function inchesToHeight(inches: number): string {
  if (!isFinite(inches) || inches <= 0) return '';
  return `${Math.floor(inches / 12)}'${String(Math.round(inches % 12)).padStart(2, '0')}"`;
}

/** 61. Normalise any height input to `F'II"`. */
export function formatHeight(h: string): string { const i = heightToInches(h); return i ? inchesToHeight(i) : (h || ''); }

/** 62. Inches → centimetres. */
export function inchesToCm(inches: number): number { return Math.round(inches * 2.54); }

/** 63. Centimetres → inches. */
export function cmToInches(cm: number): number { return Math.round(cm / 2.54); }

/** 64. Parse a weight string → pounds. */
export function weightToLbs(w: string): number | null {
  const s = (w || '').trim().toUpperCase();
  let m = s.match(/^(\d+)\s*KG$/); if (m) return Math.round(+m[1] * 2.20462);
  m = s.match(/^(\d+)\s*(LB|LBS)?$/); if (m) return +m[1];
  return null;
}

/** 65. Pounds → kilograms. */
export function lbsToKg(lbs: number): number { return Math.round(lbs / 2.20462); }

/** 66. Kilograms → pounds. */
export function kgToLbs(kg: number): number { return Math.round(kg * 2.20462); }

/** 67. 3-letter AAMVA eye code → English. */
export function eyeColorName(code: string): string { return EYE_NAMES[(code || '').toUpperCase()] || (code || ''); }

/** 68. 3-letter AAMVA hair code → English. */
export function hairColorName(code: string): string { return HAIR_NAMES[(code || '').toUpperCase()] || (code || ''); }

/** 69. Coarse height category. */
export function heightCategory(h: string): string {
  const i = heightToInches(h);
  if (i === null) return 'unknown';
  if (i < 60) return 'short';
  if (i < 70) return 'average';
  if (i < 75) return 'tall';
  return 'very tall';
}

/** 70. Coarse build from weight + height (BMI bucket). */
export function buildCategory(h: string, w: string): string {
  const i = heightToInches(h), lbs = weightToLbs(w);
  if (!i || !lbs) return 'unknown';
  const bmi = (lbs / (i * i)) * 703;
  if (bmi < 18.5) return 'slight';
  if (bmi < 25) return 'medium';
  if (bmi < 30) return 'heavy';
  return 'large';
}

/** 71. One-line physical descriptor string. */
export function descriptorLine(eye: string, hair: string, h: string, w: string): string {
  return [eyeColorName(eye) && `Eyes ${eyeColorName(eye)}`, hairColorName(hair) && `Hair ${hairColorName(hair)}`,
    formatHeight(h), weightToLbs(w) && `${weightToLbs(w)} lbs`].filter(Boolean).join(', ');
}

/** 72. True if a height value is physically plausible (48"–90"). */
export function isPlausibleHeight(h: string): boolean { const i = heightToInches(h); return i !== null && i >= 48 && i <= 90; }

// ════════════════════════════════════════════════════════════
// 6. CLASS / RESTRICTION / ENDORSEMENT CODES (73–86)
// ════════════════════════════════════════════════════════════

/** 73. Expand a single restriction code. */
export function expandRestriction(code: string): string { return RESTRICTION_CODES[(code || '').toUpperCase()] || code || ''; }

/** 74. Expand a single endorsement code. */
export function expandEndorsement(code: string): string { return ENDORSEMENT_CODES[(code || '').toUpperCase()] || code || ''; }

/** 75. Expand a vehicle-class code. */
export function expandClass(code: string): string { return CLASS_CODES[(code || '').toUpperCase()] || code || ''; }

/** 76. Split a restriction string into expanded entries. */
export function parseRestrictions(s: string): string[] {
  if (!s || SENTINEL.test(s.trim())) return [];
  return s.split(/[\s,;]+/).filter(Boolean).map(expandRestriction);
}

/** 77. Split an endorsement string into expanded entries. */
export function parseEndorsements(s: string): string[] {
  if (!s || SENTINEL.test(s.trim())) return [];
  return s.split(/[\s,;]+/).filter(Boolean).map(expandEndorsement);
}

/** 78. True if the class is a commercial (CDL) class. */
export function isCommercialClass(cls: string): boolean { return /^[ABC]$/i.test((cls || '').trim()) && (cls || '').toUpperCase() !== 'D'; }

/** 79. True if the holder has any motorcycle endorsement/class. */
export function hasMotorcycle(cls: string, endorsements: string): boolean {
  return /M/i.test(cls || '') || /\bM\b/i.test(endorsements || '');
}

/** 80. True if a hazmat endorsement is present. */
export function hasHazmat(endorsements: string): boolean { return /\b[HX]\b/i.test(endorsements || ''); }

/** 81. True if a passenger/school-bus endorsement is present. */
export function hasPassengerEndorsement(endorsements: string): boolean { return /\b[PS]\b/i.test(endorsements || ''); }

/** 82. True if restrictions require corrective lenses. */
export function requiresCorrectiveLenses(restrictions: string): boolean { return /\bB\b/i.test(restrictions || ''); }

/** 83. Summarise endorsements as a comma list of names. */
export function endorsementSummary(endorsements: string): string { return parseEndorsements(endorsements).join(', '); }

/** 84. Summarise restrictions as a comma list of names. */
export function restrictionSummary(restrictions: string): string { return parseRestrictions(restrictions).join(', '); }

/** 85. True if the license is a basic operator class (D/none). */
export function isBasicOperator(cls: string): boolean { const c = (cls || '').trim().toUpperCase(); return c === '' || c === 'D' || c === 'C'; }

/** 86. Count of endorsements present. */
export function endorsementCount(endorsements: string): number { return parseEndorsements(endorsements).length; }

// ════════════════════════════════════════════════════════════
// 7. REAL ID / COMPLIANCE / DOCUMENT TYPE (87–93)
// ════════════════════════════════════════════════════════════

/** 87. REAL ID compliance from a parsed result (true/false/null). */
export function isRealIdCompliant(r: Pick<AamvaResult, 'is_real_id'>): boolean | null { return r.is_real_id; }

/** 88. REAL ID status label. */
export function realIdStatus(r: Pick<AamvaResult, 'is_real_id'>): string {
  return r.is_real_id === true ? 'REAL ID compliant' : r.is_real_id === false ? 'NOT REAL ID compliant' : 'Unknown';
}

/** 89. True if the card is an ID card (not a driver license). */
export function isIdCardOnly(r: Pick<AamvaResult, 'card_type'>): boolean { return r.card_type === 'ID'; }

/** 90. Document-type label. */
export function documentTypeLabel(r: Pick<AamvaResult, 'card_type'>): string {
  return r.card_type === 'DL' ? "Driver's License" : r.card_type === 'ID' ? 'Identification Card' : 'Unknown Document';
}

/** 91. Organ-donor label. */
export function organDonorLabel(r: Pick<AamvaResult, 'is_organ_donor'>): string {
  return r.is_organ_donor === true ? 'Organ donor' : r.is_organ_donor === false ? 'Not a donor' : '';
}

/** 92. Veteran label. */
export function veteranLabel(r: Pick<AamvaResult, 'is_veteran'>): string { return r.is_veteran ? 'Veteran' : ''; }

/** 93. Compliance badge set for a parsed result. */
export function complianceBadges(r: AamvaResult): string[] {
  const out: string[] = [];
  if (r.is_real_id === true) out.push('REAL ID');
  if (r.is_real_id === false) out.push('NOT REAL ID');
  if (r.card_type === 'ID') out.push('ID CARD ONLY');
  if (r.is_organ_donor) out.push('DONOR');
  if (r.is_veteran) out.push('VETERAN');
  return out;
}

// ════════════════════════════════════════════════════════════
// 8. VALIDATION & QUALITY (94–98)
// ════════════════════════════════════════════════════════════

const CRITICAL_FIELDS: Array<keyof AamvaResult> = ['first_name', 'last_name', 'date_of_birth', 'dl_number', 'dl_state'];

/** 94. List the critical fields missing from a parsed result. */
export function missingCriticalFields(r: Partial<AamvaResult>): string[] {
  return CRITICAL_FIELDS.filter(f => { const v = r[f]; return !v || SENTINEL.test(String(v).trim()); }) as string[];
}

/** 95. Field-completeness ratio (0..1) over the critical set. */
export function fieldCompleteness(r: Partial<AamvaResult>): number {
  return (CRITICAL_FIELDS.length - missingCriticalFields(r).length) / CRITICAL_FIELDS.length;
}

/** 96. Scan-quality score (0..100) blending completeness + plausibility. */
export function scanQualityScore(r: Partial<AamvaResult>): number {
  let score = fieldCompleteness(r) * 70;
  if (r.date_of_birth && isValidIsoDate(r.date_of_birth)) score += 10;
  if (r.height && isPlausibleHeight(r.height)) score += 10;
  if (r.dl_state && r.dl_number && validateDlNumber(r.dl_state, r.dl_number)) score += 10;
  return Math.round(Math.min(100, score));
}

/** 97. True if a DOB is plausible (age 0..120, valid date). */
export function isPlausibleDob(dobIso: string, on?: Date): boolean { const a = ageFromDob(dobIso, on); return a !== null && a >= 0 && a <= 120; }

/** 98. Overall validity verdict for a parsed result. */
export function isUsableScan(r: Partial<AamvaResult>): boolean { return missingCriticalFields(r).length === 0 && scanQualityScore(r) >= 60; }

// ════════════════════════════════════════════════════════════
// 9. SAFETY SUMMARY & BRIDGE (99–100)
// ════════════════════════════════════════════════════════════

/** 99. Build a one-line subject summary for radio/CAD use. */
export function subjectSummaryLine(r: Partial<AamvaResult>): string {
  const name = [r.last_name, r.first_name].filter(Boolean).join(', ');
  return [
    name || 'UNKNOWN',
    r.date_of_birth && `DOB ${r.date_of_birth}`,
    r.dl_number && `OLN ${r.dl_number} (${r.dl_state || '?'})`,
    r.gender,
    r.height && formatHeight(r.height),
  ].filter(Boolean).join(' · ');
}

/** Full derived intelligence for a parsed DL — the iOS↔desktop contract. */
export interface DlEvaluation {
  jurisdiction: string;
  jurisdictionName: string;
  country: string;
  dlValid: boolean;
  age: number | null;
  ageBracket: string;
  eligibility: Record<string, boolean>;
  expiry: string;
  expiringSoon: boolean;
  height: string;
  descriptors: string;
  realId: string;
  documentType: string;
  badges: string[];
  endorsements: string[];
  restrictions: string[];
  quality: number;
  usable: boolean;
  missing: string[];
  summary: string;
}

/**
 * 100. Single bridge entry point. The iOS app posts a parsed result (or
 * the desktop passes one) and gets back every derived datum the UI needs
 * in one call — keeps the iOS↔desktop contract to a single function.
 */
export function evaluateDl(r: AamvaResult, now: Date = new Date()): DlEvaluation {
  return {
    jurisdiction: normalizeJurisdiction(r.dl_state),
    jurisdictionName: jurisdictionName(r.dl_state),
    country: jurisdictionCountry(r.dl_state) || r.country || '',
    dlValid: validateDlNumber(r.dl_state, r.dl_number),
    age: ageFromDob(r.date_of_birth, now),
    ageBracket: ageBracket(r.date_of_birth, now),
    eligibility: r.date_of_birth ? eligibilityFlags(r.date_of_birth, now) : {},
    expiry: expiryStatus(r.dl_expiry, 30, now),
    expiringSoon: isExpiringSoon(r.dl_expiry, 30, now),
    height: formatHeight(r.height),
    descriptors: descriptorLine(r.raw_elements?.DAY || '', r.raw_elements?.DAZ || '', r.height, r.weight),
    realId: realIdStatus(r),
    documentType: documentTypeLabel(r),
    badges: complianceBadges(r),
    endorsements: parseEndorsements(r.dl_endorsements),
    restrictions: parseRestrictions(r.dl_restrictions),
    quality: scanQualityScore(r),
    usable: isUsableScan(r),
    missing: missingCriticalFields(r),
    summary: subjectSummaryLine(r),
  };
}
