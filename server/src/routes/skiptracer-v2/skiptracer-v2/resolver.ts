// ============================================================
// Skip Tracker 3.5 — Identity Resolver
// ============================================================
// Cross-references results from multiple data sources and merges
// them into unified DossierProfile objects. Pure logic — no DB,
// no API calls, no Express imports.

import { randomUUID } from 'crypto';
import type {
  SourceResult,
  SkipTracerSourceCategory,
  DossierProfile,
  AddressRecord,
  PhoneRecord,
} from './types';
import { localNow } from '../../utils/timeUtils';

// ============================================================
// String Helpers
// ============================================================

/** Lowercase, trim, strip non-alphanumeric (keep spaces) */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

/** Strip everything except digits */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** Levenshtein edit distance between two strings */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single-row optimisation to keep memory O(n)
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ============================================================
// Soundex — Classic American Soundex algorithm
// ============================================================

const SOUNDEX_MAP: Record<string, string> = {
  b: '1', f: '1', p: '1', v: '1',
  c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
  d: '3', t: '3',
  l: '4',
  m: '5', n: '5',
  r: '6',
};

/**
 * Classic American Soundex. Returns a 4-character code (e.g. "S530" for "Smith").
 * Returns empty string for empty input.
 */
export function soundex(word: string): string {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length === 0) return '';

  let code = cleaned[0].toUpperCase();
  let prevDigit = SOUNDEX_MAP[cleaned[0]] ?? '0';

  for (let i = 1; i < cleaned.length && code.length < 4; i++) {
    const digit = SOUNDEX_MAP[cleaned[i]];
    if (digit && digit !== prevDigit) {
      code += digit;
    }
    // H and W are ignored but don't reset the previous digit
    if (cleaned[i] !== 'h' && cleaned[i] !== 'w') {
      prevDigit = digit ?? '0';
    }
  }

  return code.padEnd(4, '0');
}

// ============================================================
// Double Metaphone — Simplified implementation
// ============================================================

/**
 * Simplified Double Metaphone. Returns [primary, alternate] codes.
 * Handles common English/Spanish name patterns: "Smith/Smyth",
 * "Johnson/Jonson", "Garcia/Garzia", "Wright/Rite", "Pfeffer/Fefer".
 */
export function doubleMetaphone(word: string): [string, string] {
  const original = word.toUpperCase();
  const len = original.length;
  if (len === 0) return ['', ''];

  let primary = '';
  let alternate = '';
  let pos = 0;
  const maxLen = 6;

  // Helper: is character a vowel?
  const isVowel = (c: string) => 'AEIOU'.includes(c);
  const charAt = (i: number) => (i >= 0 && i < len ? original[i] : '');
  const substr = (i: number, n: number) => original.substring(i, i + n);

  // Skip silent leading consonant clusters
  if (['GN', 'KN', 'PN', 'AE', 'WR'].includes(substr(0, 2))) {
    pos = 1;
  }

  // Handle initial X → S
  if (charAt(0) === 'X') {
    primary += 'S';
    alternate += 'S';
    pos = 1;
  }

  while (pos < len && (primary.length < maxLen || alternate.length < maxLen)) {
    const c = charAt(pos);

    // Vowels — only encoded at start
    if (isVowel(c)) {
      if (pos === 0) { primary += 'A'; alternate += 'A'; }
      pos++;
      continue;
    }

    switch (c) {
      case 'B':
        primary += 'P'; alternate += 'P';
        pos += (charAt(pos + 1) === 'B') ? 2 : 1;
        break;

      case 'C':
        if (substr(pos, 2) === 'CH') {
          primary += 'X'; alternate += 'X';
          pos += 2;
        } else if (substr(pos, 2) === 'CK') {
          primary += 'K'; alternate += 'K';
          pos += 2;
        } else if ('IEY'.includes(charAt(pos + 1))) {
          // Italian vs other: CI, CE, CY
          primary += 'S'; alternate += 'S';
          pos += 2;
        } else {
          primary += 'K'; alternate += 'K';
          pos += (charAt(pos + 1) === 'C' && charAt(pos + 1) !== 'I') ? 2 : 1;
        }
        break;

      case 'D':
        if (substr(pos, 2) === 'DG') {
          if ('IEY'.includes(charAt(pos + 2))) {
            primary += 'J'; alternate += 'J'; pos += 3;
          } else {
            primary += 'TK'; alternate += 'TK'; pos += 2;
          }
        } else {
          primary += 'T'; alternate += 'T';
          pos += (charAt(pos + 1) === 'D') ? 2 : 1;
        }
        break;

      case 'F':
        primary += 'F'; alternate += 'F';
        pos += (charAt(pos + 1) === 'F') ? 2 : 1;
        break;

      case 'G':
        if (charAt(pos + 1) === 'H') {
          if (pos > 0 && !isVowel(charAt(pos - 1))) {
            primary += 'K'; alternate += 'K'; pos += 2;
          } else if (pos === 0) {
            primary += 'K'; alternate += 'K'; pos += 2;
          } else {
            pos += 2; // silent GH
          }
        } else if (charAt(pos + 1) === 'N') {
          pos += 2; // silent GN
        } else if ('IEY'.includes(charAt(pos + 1))) {
          primary += 'J'; alternate += 'K'; pos += 2;
        } else {
          primary += 'K'; alternate += 'K';
          pos += (charAt(pos + 1) === 'G') ? 2 : 1;
        }
        break;

      case 'H':
        // H is coded only if followed by a vowel and preceded by a non-vowel (or at start)
        if (isVowel(charAt(pos + 1)) && (pos === 0 || !isVowel(charAt(pos - 1)))) {
          primary += 'H'; alternate += 'H';
        }
        pos++;
        break;

      case 'J':
        primary += 'J'; alternate += 'H'; // Spanish J → H
        pos += (charAt(pos + 1) === 'J') ? 2 : 1;
        break;

      case 'K':
        primary += 'K'; alternate += 'K';
        pos += (charAt(pos + 1) === 'K') ? 2 : 1;
        break;

      case 'L':
        primary += 'L'; alternate += 'L';
        pos += (charAt(pos + 1) === 'L') ? 2 : 1;
        break;

      case 'M':
        primary += 'M'; alternate += 'M';
        pos += (charAt(pos + 1) === 'M') ? 2 : 1;
        break;

      case 'N':
        primary += 'N'; alternate += 'N';
        pos += (charAt(pos + 1) === 'N') ? 2 : 1;
        break;

      case 'P':
        if (charAt(pos + 1) === 'H') {
          primary += 'F'; alternate += 'F'; pos += 2;
        } else {
          primary += 'P'; alternate += 'P';
          pos += (charAt(pos + 1) === 'P') ? 2 : 1;
        }
        break;

      case 'Q':
        primary += 'K'; alternate += 'K';
        pos += (charAt(pos + 1) === 'Q') ? 2 : 1;
        break;

      case 'R':
        primary += 'R'; alternate += 'R';
        pos += (charAt(pos + 1) === 'R') ? 2 : 1;
        break;

      case 'S':
        if (substr(pos, 2) === 'SH') {
          primary += 'X'; alternate += 'X'; pos += 2;
        } else if (substr(pos, 3) === 'SCH') {
          primary += 'SK'; alternate += 'SK'; pos += 3;
        } else if (charAt(pos + 1) === 'I' && 'AO'.includes(charAt(pos + 2))) {
          // SIA, SIO → X (e.g. "mansion")
          primary += 'X'; alternate += 'S'; pos += 3;
        } else {
          primary += 'S'; alternate += 'S';
          pos += (charAt(pos + 1) === 'S' || charAt(pos + 1) === 'Z') ? 2 : 1;
        }
        break;

      case 'T':
        if (substr(pos, 2) === 'TH') {
          primary += '0'; alternate += 'T'; pos += 2;
        } else if (substr(pos, 4) === 'TION' || substr(pos, 3) === 'TIA') {
          primary += 'X'; alternate += 'X'; pos += 3;
        } else {
          primary += 'T'; alternate += 'T';
          pos += (charAt(pos + 1) === 'T') ? 2 : 1;
        }
        break;

      case 'V':
        primary += 'F'; alternate += 'F';
        pos += (charAt(pos + 1) === 'V') ? 2 : 1;
        break;

      case 'W':
        if (isVowel(charAt(pos + 1))) {
          primary += 'A'; alternate += 'F'; // W before vowel
        }
        pos++;
        break;

      case 'X':
        primary += 'KS'; alternate += 'KS';
        pos += (charAt(pos + 1) === 'X') ? 2 : 1;
        break;

      case 'Y':
        if (isVowel(charAt(pos + 1))) {
          primary += 'A'; alternate += 'A';
        }
        pos++;
        break;

      case 'Z':
        primary += 'S'; alternate += 'S';
        pos += (charAt(pos + 1) === 'Z') ? 2 : 1;
        break;

      default:
        pos++;
    }
  }

  return [primary.slice(0, maxLen), alternate.slice(0, maxLen)];
}

/** Check if two names match phonetically via Double Metaphone */
export function metaphoneMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const [aPri, aAlt] = doubleMetaphone(a);
  const [bPri, bAlt] = doubleMetaphone(b);
  if (!aPri || !bPri) return false;
  return aPri === bPri || aPri === bAlt || aAlt === bPri || aAlt === bAlt;
}

// ============================================================
// Name Parsing
// ============================================================

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'esq', 'phd', 'md', 'dds', 'dvm']);

interface ParsedName {
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
}

/**
 * Parse a full name string into structured parts.
 * Handles:
 *  - "LAST, First Middle Suffix" (court/arrest records)
 *  - "First Middle Last Suffix" (standard)
 *  - Hyphenated last names (e.g. "Garcia-Lopez")
 *  - Common suffixes: Jr, Sr, II, III, IV, V, Esq, PhD, MD
 */
export function parseName(fullName: string): ParsedName {
  if (!fullName) return { firstName: '', middleName: '', lastName: '', suffix: '' };

  let cleaned = fullName.trim().replace(/\s+/g, ' ');

  // Detect "LAST, First ..." format
  const commaIdx = cleaned.indexOf(',');
  let parts: string[];
  let lastName: string;
  let firstName: string;
  let middleName = '';
  let suffix = '';

  if (commaIdx > 0) {
    // "LAST, First Middle Suffix" format
    lastName = cleaned.substring(0, commaIdx).trim();
    const rest = cleaned.substring(commaIdx + 1).trim();
    parts = rest.split(/\s+/);

    // Extract suffix from end
    if (parts.length > 0 && SUFFIXES.has(parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) {
      suffix = parts.pop()!;
    }

    firstName = parts[0] ?? '';
    middleName = parts.slice(1).join(' ');
  } else {
    // "First Middle Last Suffix" format
    parts = cleaned.split(/\s+/);

    // Extract suffix from end
    if (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) {
      suffix = parts.pop()!;
    }

    if (parts.length === 1) {
      firstName = parts[0];
      lastName = '';
    } else if (parts.length === 2) {
      firstName = parts[0];
      lastName = parts[1];
    } else {
      firstName = parts[0];
      // Check for hyphenated or multi-word last names:
      // If the last two tokens are "De La", "Van Der", etc. or hyphenated, treat as compound last
      const lastPart = parts[parts.length - 1];
      if (lastPart.includes('-')) {
        // Hyphenated last name is just the last token
        lastName = lastPart;
        middleName = parts.slice(1, -1).join(' ');
      } else {
        // Default: last token is last name, everything in between is middle
        lastName = parts[parts.length - 1];
        middleName = parts.slice(1, -1).join(' ');
      }
    }
  }

  return {
    firstName: firstName.trim(),
    middleName: middleName.trim(),
    lastName: lastName.trim(),
    suffix: suffix.trim(),
  };
}

// ============================================================
// Age / DOB Calculation
// ============================================================

/**
 * Calculate age from DOB string (YYYY-MM-DD). Returns undefined if invalid.
 */
export function ageFromDob(dob: string): number | undefined {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const monthDiff = now.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) {
    age--;
  }
  return age >= 0 ? age : undefined;
}

/**
 * Estimate a DOB year from an age. Returns "YYYY-01-01" as an estimated DOB.
 */
export function estimateDobFromAge(age: number): string {
  const year = new Date().getFullYear() - age;
  return `${year}-01-01`;
}

/**
 * Check if two DOBs are within N years of each other.
 */
function dobWithinYears(dobA: string, dobB: string, years: number): boolean {
  const a = new Date(dobA);
  const b = new Date(dobB);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return false;
  const diffMs = Math.abs(a.getTime() - b.getTime());
  const diffYears = diffMs / (365.25 * 24 * 60 * 60 * 1000);
  return diffYears <= years;
}

// ============================================================
// Address Normalization
// ============================================================

const STREET_TYPE_MAP: Record<string, string> = {
  street: 'st', str: 'st',
  avenue: 'ave', av: 'ave',
  boulevard: 'blvd', boul: 'blvd',
  drive: 'dr', drv: 'dr',
  lane: 'ln',
  road: 'rd',
  court: 'ct',
  circle: 'cir', circ: 'cir',
  place: 'pl',
  terrace: 'ter', terr: 'ter',
  trail: 'trl',
  way: 'way',
  highway: 'hwy', hiway: 'hwy',
  parkway: 'pkwy', pky: 'pkwy',
  expressway: 'expy', expwy: 'expy',
  freeway: 'fwy',
  pike: 'pike',
  square: 'sq',
  loop: 'loop',
  crossing: 'xing',
  alley: 'aly',
  point: 'pt',
  run: 'run',
  pass: 'pass',
  ridge: 'rdg',
  cove: 'cv',
  bend: 'bnd',
  canyon: 'cyn',
  heights: 'hts',
  meadow: 'mdw', meadows: 'mdws',
  springs: 'spgs', spring: 'spg',
  creek: 'crk',
  view: 'vw',
  valley: 'vly',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  apartment: 'apt', suite: 'ste', unit: 'unit', building: 'bldg',
  floor: 'fl', room: 'rm', department: 'dept',
};

/**
 * Normalize a street address for comparison.
 * Standardizes street types, case, and directionals.
 */
export function normalizeStreet(street: string): string {
  return street
    .toLowerCase()
    .trim()
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => STREET_TYPE_MAP[w] ?? w)
    .join(' ');
}

/**
 * Strip apartment/unit/suite information from an address for base-address comparison.
 * Returns just the street number + street name + street type.
 */
export function stripUnit(street: string): string {
  const normalized = normalizeStreet(street);
  // Remove "apt X", "ste X", "unit X", "#X", "bldg X", "fl X", "rm X", "dept X"
  return normalized
    .replace(/\b(apt|ste|suite|unit|bldg|fl|rm|dept|spc|lot|trlr|#)\s*\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================
// Phone Normalization
// ============================================================

/**
 * Normalize a phone number to 10 digits (US).
 * Strips country code +1, extensions, and non-digit chars.
 */
export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  // Strip leading 1 if 11 digits (US country code)
  if (digits.length === 11 && digits[0] === '1') {
    digits = digits.slice(1);
  }
  // Only return if it's a valid 10-digit US number
  return digits.length === 10 ? digits : digits;
}

// ============================================================
// Extracted Identity — lightweight struct for matching
// ============================================================

interface ExtractedIdentity {
  /** Index into the original SourceResult[] */
  idx: number;
  firstName: string;
  lastName: string;
  dob: string | null;
  age: number | undefined;
  city: string | null;
  state: string | null;
  phones: string[];   // normalized 10-digit
  emails: string[];   // lowercase
  sourceType: SkipTracerSourceCategory;
}

/** Pull the best identity fields out of a SourceResult */
function extractIdentity(r: SourceResult, idx: number): ExtractedIdentity {
  const nameRec = r.names?.[0];

  let firstName: string;
  let lastName: string;

  if (nameRec?.first || nameRec?.last) {
    // Structured name available — use directly
    firstName = normalizeName(nameRec.first ?? '');
    lastName = normalizeName(nameRec.last ?? '');
  } else if (nameRec?.full) {
    // Parse from full name string
    const parsed = parseName(nameRec.full);
    firstName = normalizeName(parsed.firstName);
    lastName = normalizeName(parsed.lastName);
  } else {
    firstName = '';
    lastName = '';
  }

  const dobRec = r.dobs?.[0];
  let dob = dobRec?.dob ?? null;
  let age = dobRec?.age;

  // If DOB but no age, calculate age
  if (dob && age === undefined) {
    age = ageFromDob(dob);
  }
  // If age but no DOB, estimate DOB
  if (!dob && age !== undefined && age > 0) {
    dob = estimateDobFromAge(age);
  }

  // Best address for city/state
  const addr = r.addresses?.[0];
  const city = addr?.city ? normalizeName(addr.city) : null;
  const state = addr?.state ? addr.state.toUpperCase().trim() : null;

  const phones = (r.phones ?? []).map(p => normalizePhone(p.number)).filter(Boolean);
  const emails = (r.emails ?? []).map(e => e.address.toLowerCase().trim()).filter(Boolean);

  return { idx, firstName, lastName, dob, age, city, state, phones, emails, sourceType: r.sourceType };
}

// ============================================================
// Identity Matching
// ============================================================

/** Score how likely two identities refer to the same person. Returns 0 if no match. */
function matchScore(a: ExtractedIdentity, b: ExtractedIdentity): number {
  // Must have at least a last name to compare
  if (!a.lastName || !b.lastName) return 0;

  const lastExact = a.lastName === b.lastName;
  const firstExact = a.firstName === b.firstName && a.firstName !== '';
  const dobMatch = a.dob !== null && b.dob !== null && a.dob === b.dob;

  const cityStateOverlap =
    a.city !== null && b.city !== null &&
    a.state !== null && b.state !== null &&
    a.city === b.city && a.state === b.state;

  const phonesOverlap = a.phones.some(p => b.phones.includes(p));
  const emailsOverlap = a.emails.some(e => b.emails.includes(e));

  // Phonetic matching
  const lastSoundexMatch = soundex(a.lastName) === soundex(b.lastName) && soundex(a.lastName) !== '';
  const lastMetaphoneMatch = metaphoneMatch(a.lastName, b.lastName);
  const firstMetaphoneMatch = metaphoneMatch(a.firstName, b.firstName);

  const sameFirstInitial =
    a.firstName.length > 0 && b.firstName.length > 0 &&
    a.firstName[0] === b.firstName[0];

  const dobWithin2Years =
    a.dob !== null && b.dob !== null && dobWithinYears(a.dob, b.dob, 2);

  const sameState =
    a.state !== null && b.state !== null && a.state === b.state;

  // Rule 1: exact last+first+DOB → 0.95
  if (lastExact && firstExact && dobMatch) return 0.95;

  // Rule 4 (checked before rule 2 since it requires DOB): fuzzy name + DOB → 0.80
  if (dobMatch) {
    const lastDist = levenshtein(a.lastName, b.lastName);
    const firstDist = levenshtein(a.firstName, b.firstName);
    if (lastDist <= 2 && firstDist <= 2) return 0.80;
  }

  // Rule 2: exact last+first + overlapping city/state → 0.75
  if (lastExact && firstExact && cityStateOverlap) return 0.75;

  // Rule 5 (new): Soundex lastName match + same first initial + DOB within 2 years → 0.70
  if (lastSoundexMatch && sameFirstInitial && dobWithin2Years) return 0.70;

  // Rule 3: phone or email match + same last name → 0.65
  if (lastExact && (phonesOverlap || emailsOverlap)) return 0.65;

  // Rule 6 (new): Soundex lastName match + same firstName + same state → 0.60
  if (lastSoundexMatch && firstExact && sameState) return 0.60;

  // Rule 7 (new): Metaphone match on both first+last names + DOB within 2 years → 0.65
  if (lastMetaphoneMatch && firstMetaphoneMatch && dobWithin2Years) return 0.65;

  // Rule 8 (new): Metaphone last match + exact first + city/state overlap → 0.60
  if (lastMetaphoneMatch && firstExact && cityStateOverlap) return 0.60;

  return 0;
}

// ============================================================
// Union-Find for grouping matched results
// ============================================================

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) { this.parent[ra] = rb; }
    else if (this.rank[ra] > this.rank[rb]) { this.parent[rb] = ra; }
    else { this.parent[rb] = ra; this.rank[ra]++; }
  }

  groups(): Map<number, number[]> {
    const m = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      if (!m.has(root)) m.set(root, []);
      m.get(root)!.push(i);
    }
    return m;
  }
}

// ============================================================
// Deduplication Helpers
// ============================================================

/** Unique addresses by normalised (street + city + state + zip), ignoring apt/unit differences */
export function dedupeAddresses(addresses: AddressRecord[]): AddressRecord[] {
  const seen = new Map<string, AddressRecord>();
  for (const a of addresses) {
    const baseStreet = stripUnit(a.street);
    const key = [
      baseStreet,
      normalizeName(a.city),
      a.state.toUpperCase().trim(),
      digitsOnly(a.zip).slice(0, 5),
    ].join('|');
    if (!seen.has(key)) seen.set(key, a);
  }
  return Array.from(seen.values());
}

/** Unique phones by normalized number */
export function dedupePhones(phones: PhoneRecord[]): PhoneRecord[] {
  const seen = new Map<string, PhoneRecord>();
  for (const p of phones) {
    const key = normalizePhone(p.number);
    if (key && !seen.has(key)) seen.set(key, p);
  }
  return Array.from(seen.values());
}

/** Unique emails by lowercase address */
export function dedupeEmails(
  emails: Array<{ source: string; address: string; type?: string; verified?: boolean }>
): Array<{ source: string; address: string; type?: string; verified?: boolean }> {
  const seen = new Map<string, typeof emails[number]>();
  for (const e of emails) {
    const key = e.address.toLowerCase().trim();
    if (key && !seen.has(key)) seen.set(key, e);
  }
  return Array.from(seen.values());
}

// ============================================================
// Profile Merging
// ============================================================

/** Merge a group of SourceResults (known to be the same person) into one DossierProfile */
export function mergeProfiles(results: SourceResult[], groupConfidence: number): DossierProfile {
  // Pick the most complete name (longest full_name across all results)
  let bestFirst = '';
  let bestMiddle = '';
  let bestLast = '';
  let bestSuffix = '';
  let bestFullLen = 0;
  const aliasSet = new Set<string>();

  for (const r of results) {
    for (const n of r.names ?? []) {
      // If name has structured fields, use them. Otherwise parse from full name.
      let first = n.first ?? '';
      let middle = n.middle ?? '';
      let last = n.last ?? '';
      let suffix = n.suffix ?? '';

      if (!first && !last && n.full) {
        const parsed = parseName(n.full);
        first = parsed.firstName;
        middle = parsed.middleName;
        last = parsed.lastName;
        suffix = parsed.suffix;
      }

      const fullLen = (n.full ?? [first, middle, last, suffix].filter(Boolean).join(' ')).length;
      if (fullLen > bestFullLen) {
        bestFullLen = fullLen;
        bestFirst = first;
        bestMiddle = middle;
        bestLast = last;
        bestSuffix = suffix;
      }
      if (n.full) aliasSet.add(n.full);
    }
  }

  // Take first non-null DOB, and calculate/fill age
  let dob: string | undefined;
  let age: number | undefined;
  for (const r of results) {
    if (r.dobs?.[0]) {
      dob = r.dobs[0].dob;
      age = r.dobs[0].age;
      break;
    }
  }
  // If DOB but no age, calculate
  if (dob && age === undefined) {
    age = ageFromDob(dob);
  }
  // If age but no DOB, estimate
  if (!dob && age !== undefined && age > 0) {
    dob = estimateDobFromAge(age);
  }

  // First non-null SSN last4
  let ssn_last4: string | undefined;
  for (const r of results) {
    if (r.ssns?.[0]) { ssn_last4 = r.ssns[0].last4; break; }
  }

  // First photo
  let photoUrl: string | undefined;
  for (const r of results) {
    if (r.photos?.[0]) { photoUrl = r.photos[0].url; break; }
  }

  // Remove the "best" name from aliases
  const bestFull = [bestFirst, bestMiddle, bestLast, bestSuffix].filter(Boolean).join(' ');
  aliasSet.delete(bestFull);
  // Also remove very similar strings
  for (const a of aliasSet) {
    if (normalizeName(a) === normalizeName(bestFull)) aliasSet.delete(a);
  }

  // Collect unique sources
  const sources = [...new Set(results.map(r => r.source))];

  // Concatenate + deduplicate sub-records
  const addresses = dedupeAddresses(results.flatMap(r => r.addresses ?? []));
  const phones = dedupePhones(results.flatMap(r => r.phones ?? []));
  const emails = dedupeEmails(results.flatMap(r => r.emails ?? []));

  // For record types without a custom deduper, just concat (they have unique IDs/case numbers)
  const socialProfiles = results.flatMap(r => r.socialProfiles ?? []);
  const associates = results.flatMap(r => r.associates ?? []);
  const courtRecords = results.flatMap(r => r.courtRecords ?? []);
  const propertyRecords = results.flatMap(r => r.propertyRecords ?? []);
  const licenses = results.flatMap(r => r.licenses ?? []);
  const vehicles = results.flatMap(r => r.vehicles ?? []);
  const businesses = results.flatMap(r => r.businesses ?? []);
  const watchlistFlags = results.flatMap(r => r.watchlistFlags ?? []);
  const sexOffenderRecords = results.flatMap(r => r.sexOffenderRecords ?? []);
  const custodyRecords = results.flatMap(r => r.custodyRecords ?? []);
  const photos = results.flatMap(r => r.photos ?? []);

  // Confidence = max of the group match score and individual source confidences
  const maxSourceConf = Math.max(...results.map(r => r.confidence), 0);
  let confidenceScore = Math.max(groupConfidence, maxSourceConf);

  // ---- Confidence boosts ----

  // Boost: multiple independent sources agree → +0.05 per additional source (cap at 0.99)
  const uniqueSources = new Set(results.map(r => r.source));
  if (uniqueSources.size > 1) {
    const boost = (uniqueSources.size - 1) * 0.05;
    confidenceScore = Math.min(confidenceScore + boost, 0.99);
  }

  // Boost: data spans 3+ source categories → +0.10
  const categories = new Set(results.map(r => r.sourceType));
  if (categories.size >= 3) {
    confidenceScore = Math.min(confidenceScore + 0.10, 0.99);
  }

  return {
    id: randomUUID(),
    firstName: bestFirst || undefined,
    middleName: bestMiddle || undefined,
    lastName: bestLast || undefined,
    suffix: bestSuffix || undefined,
    aliases: aliasSet.size > 0 ? [...aliasSet] : undefined,
    dob,
    age,
    ssn_last4,
    photoUrl,
    addresses,
    phones,
    emails,
    socialProfiles,
    associates,
    courtRecords,
    propertyRecords,
    licenses,
    vehicles,
    businesses,
    watchlistFlags,
    sexOffenderRecords,
    custodyRecords,
    photos,
    sources,
    confidenceScore: Math.round(confidenceScore * 100) / 100,
  };
}

// ============================================================
// Main Entry Point
// ============================================================

/**
 * Resolve a flat array of SourceResults into deduplicated DossierProfiles.
 *
 * 1. Extract lightweight identity from each result
 * 2. Pairwise score all identities, union those that match
 * 3. Merge each group into a DossierProfile
 * 4. Return sorted by confidence (highest first)
 */
export function resolveResults(results: SourceResult[]): DossierProfile[] {
  if (results.length === 0) return [];

  // Extract identities
  const ids = results.map((r, i) => extractIdentity(r, i));

  // Pairwise matching with Union-Find
  const uf = new UnionFind(results.length);
  const pairScores = new Map<string, number>(); // track best score per pair

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const score = matchScore(ids[i], ids[j]);
      if (score > 0) {
        uf.union(i, j);
        const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
        pairScores.set(key, Math.max(pairScores.get(key) ?? 0, score));
      }
    }
  }

  // Build profiles from groups
  const groups = uf.groups();
  const profiles: DossierProfile[] = [];

  for (const [, members] of groups) {
    const groupResults = members.map(i => results[i]);

    // Group confidence = max pairwise match score within this group
    let groupConf = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = `${Math.min(members[i], members[j])}-${Math.max(members[i], members[j])}`;
        groupConf = Math.max(groupConf, pairScores.get(key) ?? 0);
      }
    }

    profiles.push(mergeProfiles(groupResults, groupConf));
  }

  // Sort by confidence descending
  profiles.sort((a, b) => b.confidenceScore - a.confidenceScore);

  return profiles;
}
