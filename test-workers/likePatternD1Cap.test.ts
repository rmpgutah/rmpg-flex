// Pins the LIKE-pattern byte cap against REAL D1, at the helper boundary that
// every call site shares.
//
// Why here rather than per-route: the ~55 sites that used to hand-roll
// `%${term.slice(0, 48)}%` now all funnel through likePattern() /
// cappedLikePattern() / codedLike(). Asserting that those three never emit a
// pattern D1 rejects covers all of them at once, and keeps covering any site
// added later.
//
// The cap is on BYTES, and it is reproducible locally — measured in this
// harness: a 50-byte pattern succeeds, 51 throws. The character-based guards
// this replaced were correct only for ASCII; 25 accented characters is 52
// bytes but 27 UTF-16 units, so `.slice(0, 48)` passed it through into a throw.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { likePattern, D1_LIKE_MAX_BYTES } from '../src/utils/d1Like';
import { cappedLikePattern, codedLike } from '../src/utils/searchText';

const db = () => (env as unknown as { DB: D1Database }).DB;
const byteLen = (s: string) => new TextEncoder().encode(s).length;

/** Does live D1 accept this LIKE pattern? */
async function accepted(pattern: string, escape = false): Promise<true | string> {
  const sql = escape
    ? "SELECT 1 AS hit WHERE 'x' LIKE ? ESCAPE '\\'"
    : "SELECT 1 AS hit WHERE 'x' LIKE ?";
  try {
    await db().prepare(sql).bind(pattern).all();
    return true;
  } catch (err) {
    return (err as Error).message;
  }
}

// Inputs an officer or a records import can realistically produce.
const ADVERSARIAL: Array<[string, string]> = [
  ['long ASCII', 'Operating a motor vehicle while the registration is suspended or revoked'],
  ['accented', 'Café résumé naïve façade — a very long accented description indeed'],
  ['just past the cap in bytes', 'é'.repeat(25)],
  ['em dashes', '—'.repeat(40)],
  ['emoji', '🚓'.repeat(30)],
  ['all wildcards', '%'.repeat(80)],
  ['all underscores', '_'.repeat(80)],
  ['backslashes', '\\'.repeat(80)],
  ['mixed metacharacters', 'a%b_c\\d'.repeat(20)],
  ['metacharacter at the cut', `${'a'.repeat(47)}%%%%%`],
  ['absurd', 'A'.repeat(5000)],
  ['whitespace only', '   '],
  ['empty', ''],
];

describe('the local harness really does enforce the cap', () => {
  // Without this, every assertion below could be passing vacuously.
  it('accepts 50 bytes and rejects 51', async () => {
    expect(await accepted(`%${'a'.repeat(D1_LIKE_MAX_BYTES - 2)}%`)).toBe(true);
    expect(await accepted(`%${'a'.repeat(D1_LIKE_MAX_BYTES - 1)}%`)).toContain('too complex');
  });

  it('rejects a pattern that a character-based guard would have allowed', async () => {
    // 25 accented chars: 27 UTF-16 units (under any `.slice(0, 48)`), 52 bytes.
    const naive = `%${'é'.repeat(25)}%`;
    expect(naive.length).toBeLessThan(D1_LIKE_MAX_BYTES);
    expect(byteLen(naive)).toBeGreaterThan(D1_LIKE_MAX_BYTES);
    expect(await accepted(naive)).toContain('too complex');
  });
});

describe('likePattern output is always accepted by D1', () => {
  for (const [label, input] of ADVERSARIAL) {
    it(`contains: ${label}`, async () => {
      const p = likePattern(input);
      expect(byteLen(p)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
      expect(await accepted(p)).toBe(true);
    });

    it(`escaped: ${label}`, async () => {
      const p = likePattern(input, { escape: true });
      expect(byteLen(p)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
      // Under ESCAPE '\' a dangling lone backslash is an ERROR, not a literal,
      // so this also proves no escape pair was split.
      expect(await accepted(p, true)).toBe(true);
    });
  }

  for (const match of ['prefix', 'suffix'] as const) {
    it(`${match} patterns fit and are accepted`, async () => {
      const p = likePattern('A'.repeat(500), { match });
      expect(byteLen(p)).toBe(D1_LIKE_MAX_BYTES);
      expect(await accepted(p)).toBe(true);
    });
  }

  for (const caseFold of ['upper', 'lower'] as const) {
    it(`${caseFold}-folded patterns fit after folding changes length`, async () => {
      // 'ß'.toUpperCase() is 'SS' — folding can GROW the string.
      const p = likePattern('ß'.repeat(60), { caseFold });
      expect(byteLen(p)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
      expect(await accepted(p)).toBe(true);
    });
  }
});

describe('searchText helpers are accepted by D1', () => {
  for (const [label, input] of ADVERSARIAL) {
    it(`cappedLikePattern: ${label}`, async () => {
      const p = cappedLikePattern(input);
      expect(byteLen(p)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
      expect(await accepted(p, true)).toBe(true);
    });

    // codedLike expands one term into several candidate patterns (raw,
    // snake_case, reverse-mapped enum codes); EVERY bind has to fit, and it
    // used to apply no cap at all.
    it(`codedLike: ${label}`, async () => {
      const { sql, binds } = codedLike('incident_type', input);
      expect(binds).toHaveLength((sql.match(/\?/g) ?? []).length);
      for (const b of binds) {
        expect(byteLen(b), `bind=${JSON.stringify(b)}`).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
        expect(await accepted(b, true)).toBe(true);
      }
    });
  }
});
