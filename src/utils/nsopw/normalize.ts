// ============================================================
// RMPG Flex — NSOPW name + DOB normalization (cache key).
// ------------------------------------------------------------
// The normalizer collapses the many ways "John A. Smith" can be
// typed into ONE canonical identity string, then derives a cache
// key from it. This is the heart of the cache layer — bad
// normalization means cache misses (= wasted MOU quota); over-
// aggressive normalization means cross-person collisions (= one
// person's hits attached to another).
//
// Pure functions, no I/O. Unit-tested at tests/nsopwNormalize.test.ts.
// ============================================================

import type { NsopwCacheKey, NsopwQuery } from './types';

// Common name suffixes to strip — these never identify a person.
const SUFFIX_RE = /\s+(jr|sr|ii|iii|iv|v|esq)\.?$/i;

// Common name prefixes/honorifics that occasionally bleed into LE entry.
const PREFIX_RE = /^(mr|mrs|ms|miss|dr|rev|sir|hon)\.?\s+/i;

/** Lowercase, strip diacritics, drop punctuation. The base for every name op. */
export function foldName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip combining marks
    .toLowerCase()
    .replace(/[._'`-]/g, ' ')          // hyphens/apostrophes/dots collapse to space
    .replace(/[^a-z0-9\s]/g, ' ')      // drop everything else
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a single name token into its canonical identity form:
 * fold, drop honorifics, drop suffixes. The result is what we use as
 * a cache-key component and as the comparison basis in match.ts.
 *
 * Examples:
 *   "Robert Smith Jr." → "robert smith"
 *   "Dr. John A. Smith III" → "john a smith"
 *   "O'Brien-Jones" → "o brien jones"
 */
export function canonName(s: string | null | undefined): string {
  let n = foldName(s);
  if (!n) return '';
  n = n.replace(PREFIX_RE, '').trim();
  while (SUFFIX_RE.test(n)) n = n.replace(SUFFIX_RE, '').trim();
  return n;
}

/**
 * Normalize a DOB into 'YYYY-MM-DD' or '' when unparseable.
 * Accepts:
 *   '1985-06-12', '1985/06/12', '06/12/1985', '06-12-1985', '6/12/85'
 *   ISO datetimes (trims time).
 * Year 2-digit is interpreted as 1900s if it'd put the person <18 today;
 * otherwise 2000s. We err toward older — a juvenile false-cache-miss is
 * preferable to silently merging an adult and a child record.
 */
export function canonDob(input: string | null | undefined, todayYear = new Date().getFullYear()): string {
  if (!input) return '';
  const s = input.trim();
  // ISO first (YYYY-MM-DD optionally followed by Tnn:nn:...).
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  // YYYY/MM/DD
  m = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  // MM/DD/YYYY or MM-DD-YYYY
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
  if (m) return iso(+m[3], +m[1], +m[2]);
  // MM/DD/YY — 2-digit year disambiguation.
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2})$/.exec(s);
  if (m) {
    const twoYear = +m[3];
    // If using 20xx would make the person <18, fall back to 19xx.
    const guess2000 = 2000 + twoYear;
    const guess1900 = 1900 + twoYear;
    const year = (todayYear - guess2000) < 18 ? guess1900 : guess2000;
    return iso(year, +m[1], +m[2]);
  }
  return '';
}

function iso(y: number, m: number, d: number): string {
  if (!Number.isFinite(y) || y < 1900 || y > 2100) return '';
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

/**
 * Derive a cache key from a query. Same person typed three different
 * ways → same key. The order is fixed (surname|forename|dob) so the
 * key is canonical regardless of how the caller built the query.
 *
 * Forename is reduced to its FIRST token only, so 'John', 'John A',
 * 'John A.', and 'John Allen' all collapse to the same key — middle
 * initial / middle name drift is the most common source of cache
 * misses on operator-typed queries.
 *
 * Empty fields collapse to '' rather than 'undefined' so a no-DOB
 * query is its own consistent cache bucket. DOB-less queries DO cache,
 * but match.ts won't auto-confirm without DOB — they're surfaced as
 * "possible" for officer review.
 */
export function cacheKeyOf(q: NsopwQuery): NsopwCacheKey {
  const forename = canonName(q.forename).split(' ')[0] ?? '';
  return [canonName(q.surname), forename, canonDob(q.dob ?? '')].join('|');
}

/** Helpful for test fixtures + auditing. */
export function debugCanonical(q: NsopwQuery): Record<string, string> {
  return {
    surname: canonName(q.surname),
    forename: canonName(q.forename),
    middleName: canonName(q.middleName ?? ''),
    dob: canonDob(q.dob ?? ''),
    cacheKey: cacheKeyOf(q),
  };
}
