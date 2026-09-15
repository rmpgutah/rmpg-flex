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

  // Uppercasing can CHANGE byte length ('ß' -> 'SS'), so the trim has to
  // happen after the case fold, not before.
  it('measures after upper-casing when asked to fold case', () => {
    const pattern = likePattern('ß'.repeat(40), { upperCase: true });
    expect(pattern).toBe(`%${'S'.repeat(D1_LIKE_MAX_BYTES - 2)}%`);
    expect(byteLen(pattern)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
  });

  it('upper-cases the needle when asked', () => {
    expect(likePattern('main st', { upperCase: true })).toBe('%MAIN ST%');
  });

  it('trims surrounding whitespace', () => {
    expect(likePattern('  Main St  ')).toBe('%Main St%');
  });

  it('is a bare wildcard for empty input', () => {
    expect(likePattern('')).toBe('%%');
    expect(likePattern('   ')).toBe('%%');
  });
});
