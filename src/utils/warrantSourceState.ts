// Canonical source-key → US state resolution for warrant sources.
//
// WHY THIS EXISTS
// There were two implementations of this derivation and both were wrong, in
// different ways, and they disagreed with each other:
//
//   client/src/utils/warrantListHelpers.ts  stateFromSource()
//     matched /^([a-z]{2})_/ — underscore only, state as a PREFIX. Real keys are
//     hyphenated with the state as a SUFFIX ('ada-county-id'), so it returned
//     '—' for every row in production. The Warrants list SOURCE column was
//     therefore blank on every single row.
//
//   src/routes/warrants.ts  (inline, in /unified)
//     matched /^([a-z]{2})[-_]/i — still prefix-anchored. Verified against the
//     live keys, it resolves NOTHING: 'ada' is three letters, so the pattern
//     never even matches, and every one of 'ada-county-id', 'natrona-county-wy',
//     'ohio-drc-pval' and 'utah-warrant-watch' came back null. Only the legacy
//     'ut_district' shape ever worked. That null fed the ?state= filter, so
//     filtering by state matched nothing.
//
// This module is now the single authority. `/unified` stamps `source_state` onto
// every row, and the CLIENT NO LONGER DERIVES IT — the client-side helper is
// deleted rather than duplicated, because /src and /client/src share no build
// and a "shared" parser would in practice be two copies free to drift again.
//
// Returns null, never a guess, when the state cannot be determined. A wrong
// two-letter code is worse than an honest unknown: it silently mis-files a
// warrant under another jurisdiction.

export const STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', wisconsin: 'WI',
  wyoming: 'WY',
};

/**
 * Resolve the US state a warrant source belongs to.
 *
 * Handles, in order of confidence:
 *   'ada-county-id'      → 'ID'   (trailing 2-letter segment, valid state code)
 *   'natrona-county-wy'  → 'WY'
 *   'ut_district'        → 'UT'   (leading 2-letter segment — the legacy shape)
 *   'ohio-drc-pval'      → 'OH'   (a full state NAME appears as a segment)
 *   'utah-warrant-watch' → 'UT'
 *   'fed_marshals'       → 'FED'  (federal, not a state)
 *   'local'              → null
 *
 * @returns a two-letter state code, 'FED', or null when undeterminable.
 */
export function stateFromSourceKey(source: string | null | undefined): string | null {
  if (!source) return null;
  const key = String(source).trim().toLowerCase();
  if (!key) return null;

  // Federal sources are not a state; callers bucket them separately.
  if (/^(fed|federal)([-_]|$)/.test(key)) return 'FED';

  const segments = key.split(/[-_.]+/).filter(Boolean);
  if (segments.length === 0) return null;

  // 1. Trailing two-letter segment ('ada-county-id'). This is the live shape,
  //    and the one both previous implementations missed entirely by anchoring
  //    their pattern to the start of the key.
  const last = segments[segments.length - 1].toUpperCase();
  if (last.length === 2 && STATE_CODES.has(last)) return last;

  // 2. Leading two-letter segment ('ut_district') — the shape the old regexes
  //    were written for. Kept so legacy keys still resolve.
  const first = segments[0].toUpperCase();
  if (first.length === 2 && STATE_CODES.has(first)) return first;

  // 3. A spelled-out state name in any segment ('ohio-drc-pval',
  //    'utah-warrant-watch'). Checked last because it is the loosest match.
  for (const seg of segments) {
    const code = STATE_NAME_TO_CODE[seg];
    if (code) return code;
  }

  // Deliberately NOT falling back to "first two characters of the key". That
  // guess would turn 'ada-county-id' into the non-existent state 'AD'. An honest
  // null is safer than a code that mis-files a warrant under another
  // jurisdiction.
  return null;
}
