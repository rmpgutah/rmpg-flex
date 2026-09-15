import { describe, it, expect } from 'vitest';
import { D1_LIKE_MAX_BYTES, likePattern, trimToBytes } from '../src/utils/d1Like';

const byteLen = (s: string) => new TextEncoder().encode(s).length;

describe('trimToBytes', () => {
  it('leaves a short ASCII string alone', () => {
    expect(trimToBytes('123 Main St', 48)).toBe('123 Main St');
  });

  it('trims a long ASCII string to the byte budget', () => {
    const out = trimToBytes('A'.repeat(100), 48);
    expect(out).toBe('A'.repeat(48));
    expect(byteLen(out)).toBe(48);
  });

  // The whole point. `.slice(0, 40)` counts UTF-16 code units, so 40 accented
  // characters is 80 bytes and still blows a 50-byte cap.
  it('measures bytes, not characters', () => {
    const accented = 'é'.repeat(40); // 40 chars, 80 bytes
    expect(accented.length).toBe(40);
    expect(byteLen(accented)).toBe(80);
    expect(byteLen(trimToBytes(accented, 48))).toBeLessThanOrEqual(48);
  });

  it('never splits a multi-byte character', () => {
    // 'é' is 2 bytes, so an odd budget must drop the whole character.
    const out = trimToBytes('é'.repeat(10), 5);
    expect(byteLen(out)).toBe(4);
    expect(out).toBe('éé');
    expect(out).not.toContain('�');
  });

  it('never splits an astral character', () => {
    // An emoji is one code point, two UTF-16 units, four UTF-8 bytes.
    const out = trimToBytes('🚓'.repeat(4), 6);
    expect(byteLen(out)).toBe(4);
    expect(out).toBe('🚓');
  });

  it('returns empty when the budget cannot hold even one character', () => {
    expect(trimToBytes('🚓', 3)).toBe('');
  });

  it('handles an empty string and a zero budget', () => {
    expect(trimToBytes('', 48)).toBe('');
    expect(trimToBytes('abc', 0)).toBe('');
  });
});

describe('likePattern', () => {
  it('wraps the needle in the two % wildcards', () => {
    expect(likePattern('Main St')).toBe('%Main St%');
  });

  // The wrappers are part of the pattern D1 measures, so the needle budget is
  // the cap minus two -- a needle trimmed to the full cap would still overflow.
  it('keeps the whole pattern inside the D1 byte cap', () => {
    const pattern = likePattern('A'.repeat(200));
    expect(byteLen(pattern)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
    expect(byteLen(pattern)).toBe(D1_LIKE_MAX_BYTES);
  });

  it('keeps a non-ASCII pattern inside the cap too', () => {
    for (const ch of ['é', 'ñ', '—', '🚓']) {
      const pattern = likePattern(ch.repeat(100));
      expect(byteLen(pattern)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
    }
  });

  // Deliberately does NOT trim: '%  %' matches almost nothing, but '%%'
  // matches EVERY row. Most call sites guard their input for truthiness only,
  // so a helper that trimmed would silently turn a whitespace-only search
  // into an unfiltered one -- in this codebase that means dumping person
  // records. A caller that wants the trim does it itself.
  it('leaves surrounding whitespace alone', () => {
    expect(likePattern('  Main St  ')).toBe('%  Main St  %');
  });

  it('does not widen a whitespace-only needle to match-all', () => {
    expect(likePattern('   ')).toBe('%   %');
    expect(likePattern('   ')).not.toBe('%%');
  });

  it('is a bare wildcard only for genuinely empty input', () => {
    expect(likePattern('')).toBe('%%');
  });
});

// ── Escape-aware trimming ───────────────────────────────────────────────
// Escaping is not free: each escaped character costs an extra byte. Sites
// that escaped and THEN sliced could cut between a backslash and the
// character it escapes, leaving a dangling '\' — which SQLite rejects
// outright under `ESCAPE '\'` ("ESCAPE expression must be a single
// character" / invalid escape sequence), not merely over-matching. Sites
// that sliced and THEN escaped overflowed the cap instead.
describe('likePattern with escape', () => {
  it('escapes the LIKE metacharacters', () => {
    expect(likePattern('100%_raw\\', { escape: true })).toBe('%100\\%\\_raw\\\\%');
  });

  it('leaves ordinary text untouched', () => {
    expect(likePattern('Main St', { escape: true })).toBe('%Main St%');
  });

  // The regression: budget is measured on the ESCAPED text.
  it('keeps an all-metacharacter needle inside the cap', () => {
    const pattern = likePattern('%'.repeat(100), { escape: true });
    expect(byteLen(pattern)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
  });

  // The other regression: an escape pair is dropped whole or kept whole.
  //
  // Sweeping the PREFIX length is what makes this bite. An escaped '%' is a
  // 2-byte pair, so a needle of nothing but '%' lands the 48-byte cut on an
  // even boundary every time and never dangles by luck. The failing case is
  // a cut that falls between the '\' and its '%' -- e.g. 47 plain characters
  // followed by one '%', where escape-then-trim yields 47 chars + a lone '\'.
  it('never leaves a dangling escape character at any cut point', () => {
    for (let prefix = 0; prefix <= 60; prefix++) {
      const pattern = likePattern(`${'a'.repeat(prefix)}${'%'.repeat(10)}`, { escape: true });
      const needle = pattern.slice(1, -1);
      const backslashes = (needle.match(/\\/g) ?? []).length;
      const pairs = (needle.match(/\\%/g) ?? []).length;
      // Every backslash must be followed by the character it escapes.
      expect(backslashes, `prefix=${prefix} needle=${JSON.stringify(needle)}`).toBe(pairs);
      expect(byteLen(pattern)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
    }
  });

  it('never splits an escaped multi-byte character', () => {
    // A backslash cannot precede a non-metacharacter, so this is really a
    // check that mixed content still trims on character boundaries.
    const pattern = likePattern('é%'.repeat(40), { escape: true });
    expect(byteLen(pattern)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
    expect(pattern).not.toContain('�');
  });

  it('does not escape by default', () => {
    expect(likePattern('50%')).toBe('%50%%');
  });
});

describe('likePattern match modes', () => {
  it('defaults to contains', () => {
    expect(likePattern('abc')).toBe('%abc%');
  });

  it('builds a prefix pattern with one wildcard', () => {
    expect(likePattern('abc', { match: 'prefix' })).toBe('abc%');
  });

  it('builds a suffix pattern with one wildcard', () => {
    expect(likePattern('abc', { match: 'suffix' })).toBe('%abc');
  });

  // A one-wildcard pattern gets one more needle byte than a two-wildcard
  // one -- the budget is the cap minus the wildcards actually emitted.
  it('gives a prefix pattern the full cap', () => {
    const pattern = likePattern('A'.repeat(200), { match: 'prefix' });
    expect(byteLen(pattern)).toBe(D1_LIKE_MAX_BYTES);
    expect(pattern).toBe(`${'A'.repeat(D1_LIKE_MAX_BYTES - 1)}%`);
  });
});

describe('likePattern case folding', () => {
  it('upper-cases when asked', () => {
    expect(likePattern('main st', { caseFold: 'upper' })).toBe('%MAIN ST%');
  });

  it('lower-cases when asked', () => {
    expect(likePattern('MAIN ST', { caseFold: 'lower' })).toBe('%main st%');
  });

  // Folding can change byte length, so it must precede the measurement.
  it('measures after folding', () => {
    const pattern = likePattern('ß'.repeat(40), { caseFold: 'upper' });
    expect(pattern).toBe(`%${'S'.repeat(D1_LIKE_MAX_BYTES - 2)}%`);
  });
});
