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
// budget is the cap minus two.
// ============================================================

/** D1's documented LIKE/GLOB pattern limit, in bytes. */
export const D1_LIKE_MAX_BYTES = 50;

const encoder = new TextEncoder();

/** UTF-8 byte length of a string. */
export function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/**
 * Trim `value` so its UTF-8 encoding fits `maxBytes`, dropping whole
 * characters rather than splitting one (a split multi-byte character would
 * encode as a replacement char and never match anything).
 *
 * Iterates code points via `for...of`, so surrogate pairs — emoji, astral
 * scripts — are treated as single indivisible characters.
 */
export function trimToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (byteLength(value) <= maxBytes) return value;

  let out = '';
  let used = 0;
  for (const char of value) {
    const size = byteLength(char);
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return out;
}

export interface LikePatternOptions {
  /**
   * Upper-case the needle before trimming. Case folding can change byte
   * length ('ß' becomes 'SS'), so it must happen BEFORE the measurement or
   * the result can still overflow.
   */
  upperCase?: boolean;
  /** Override the byte cap. Defaults to D1_LIKE_MAX_BYTES. */
  maxBytes?: number;
}

/**
 * Build a `%needle%` LIKE pattern guaranteed to fit D1's byte cap.
 *
 * Note that trimming WIDENS the match: `%123 South Main Stre%` matches every
 * premise sharing that prefix. That is the deliberate trade — over-matching
 * beats erroring the query — but it means a caller showing results to an
 * operator should not present them as an exact-address match.
 */
export function likePattern(raw: string, options: LikePatternOptions = {}): string {
  const cap = options.maxBytes ?? D1_LIKE_MAX_BYTES;
  const trimmed = raw.trim();
  const folded = options.upperCase ? trimmed.toUpperCase() : trimmed;
  // -2 for the wrapping wildcards, which count toward the cap.
  return `%${trimToBytes(folded, cap - 2)}%`;
}
