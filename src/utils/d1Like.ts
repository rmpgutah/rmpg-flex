// ============================================================
// Byte-safe LIKE/GLOB pattern construction for D1.
//
// D1 caps a LIKE or GLOB pattern at 50 BYTES
// (https://developers.cloudflare.com/d1/platform/limits). Exceed it and the
// query fails rather than matching loosely, so any pattern built from
// caller-supplied text has to be trimmed.
//
// ⚠️ The cap is in BYTES; `String.prototype.slice` counts UTF-16 code units.
// Call sites across this repo trim with `.slice(0, 48)` or `.slice(0, 40)`,
// which is correct only for ASCII: 40 accented characters is 80 bytes and
// still overflows. An address with a diacritic, an em dash, or an emoji
// therefore errors the query despite the guard. This module measures the
// encoded length instead, and never splits a character in half.
//
// The two wrapping '%' are part of the pattern D1 measures, so the needle
// budget is the cap minus the wildcards it emits.
// ============================================================

/** D1's documented LIKE/GLOB pattern limit, in bytes. */
export const D1_LIKE_MAX_BYTES = 50;

const encoder = new TextEncoder();

/** UTF-8 byte length of a string. */
export function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/** The escape character these helpers emit. SQL must say `ESCAPE '\'`. */
export const LIKE_ESCAPE_CHAR = '\\';

const META = /[\\%_]/;

/**
 * Build a needle that fits `maxBytes`, dropping whole characters -- and, when
 * escaping, whole escape PAIRS -- rather than splitting either.
 *
 * Splitting matters in two different ways:
 *  - a halved multi-byte character encodes as U+FFFD and matches nothing;
 *  - a halved escape pair leaves a trailing lone '\', which SQLite REJECTS
 *    under `ESCAPE '\'` rather than treating as literal. That is an error,
 *    not a loose match.
 *
 * Escaping also has to happen BEFORE the measurement, because each escaped
 * character costs an extra byte: 48 literal '%' escape to 96 bytes.
 */
function buildNeedle(value: string, maxBytes: number, escape: boolean): string {
  if (maxBytes <= 0) return '';
  let out = '';
  let used = 0;
  // `for...of` iterates code points, so surrogate pairs stay intact.
  for (const char of value) {
    const piece = escape && META.test(char) ? LIKE_ESCAPE_CHAR + char : char;
    const size = byteLength(piece);
    if (used + size > maxBytes) break;
    out += piece;
    used += size;
  }
  return out;
}

/**
 * Trim `value` so its UTF-8 encoding fits `maxBytes`, dropping whole
 * characters rather than splitting one.
 */
export function trimToBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return maxBytes > 0 ? value : '';
  return buildNeedle(value, maxBytes, false);
}

/** Where the wildcards go. `contains` is the usual `%needle%`. */
export type LikeMatch = 'contains' | 'prefix' | 'suffix';

const WILDCARDS: Record<LikeMatch, readonly [string, string]> = {
  contains: ['%', '%'],
  prefix: ['', '%'],
  suffix: ['%', ''],
};

export interface LikePatternOptions {
  /**
   * Case-fold the needle. Folding can change byte length ('ß' becomes 'SS'),
   * so it is applied BEFORE the measurement.
   */
  caseFold?: 'upper' | 'lower';
  /** Override the byte cap. Defaults to D1_LIKE_MAX_BYTES. */
  maxBytes?: number;
  /**
   * Escape '\', '%' and '_' so the caller's text is matched LITERALLY.
   *
   * ⚠️ The SQL must carry `ESCAPE '\'` or the backslashes match literally
   * and the pattern is wrong. Without this option a caller-supplied '%' is
   * a wildcard -- which is the pre-existing behaviour of most call sites and
   * usually harmless for a search box, since it only widens the match.
   */
  escape?: boolean;
  /** Wildcard placement. Defaults to 'contains'. */
  match?: LikeMatch;
}

/**
 * Build a LIKE pattern guaranteed to fit D1's byte cap.
 *
 * Note that trimming WIDENS the match: `%123 South Main Stre%` matches every
 * premise sharing that prefix. That is the deliberate trade -- over-matching
 * beats erroring the query -- but a caller showing results to an operator
 * should not present them as an exact match.
 */
export function likePattern(raw: string, options: LikePatternOptions = {}): string {
  const cap = options.maxBytes ?? D1_LIKE_MAX_BYTES;
  const [lead, trail] = WILDCARDS[options.match ?? 'contains'];
  // Deliberately NOT trimmed. Trimming would turn a whitespace-only needle
  // into '%%', i.e. match-everything, and most call sites guard their input
  // only for truthiness -- so `first_name: '  '` would go from matching no
  // person to matching every person. Callers that want a trim pass a trimmed
  // string; the change in match semantics is theirs to make, not this
  // helper's.
  const folded =
    options.caseFold === 'upper' ? raw.toUpperCase()
    : options.caseFold === 'lower' ? raw.toLowerCase()
    : raw;
  // The wildcards count toward the cap, so the needle gets what is left.
  const budget = cap - lead.length - trail.length;
  return `${lead}${buildNeedle(folded, budget, options.escape === true)}${trail}`;
}
