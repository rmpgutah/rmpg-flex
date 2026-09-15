import { describe, test, expect } from 'vitest';
import {
  D1_LIKE_PATTERN_LIMIT,
  escapeLike,
  exceedsLikePatternLimit,
  containsClause,
  containedByClause,
  containsAnyClause,
  cappedLikePattern,
  codedLike,
} from '../src/utils/searchText';
import { D1_LIKE_MAX_BYTES } from '../src/utils/d1Like';

const byteLen = (s: string) => new TextEncoder().encode(s).length;

// The charge string that was returning 500s from /api/legal-data-hunter/validate.
const REAL_CHARGE = 'THEFT BY RECEIVING STOLEN PROPERTY - 3RD DEGREE FELONY';

describe('D1 LIKE pattern limit', () => {
  test('the cap matches what live D1 enforces', () => {
    expect(D1_LIKE_PATTERN_LIMIT).toBe(50);
  });

  test('real-world charge text exceeds the cap', () => {
    // 54 chars + 2 wildcards = 56 > 50. This is the recorded live failure.
    expect(REAL_CHARGE.length).toBeGreaterThan(D1_LIKE_PATTERN_LIMIT - 2);
    expect(exceedsLikePatternLimit(REAL_CHARGE)).toBe(true);
  });

  test('short terms are under the cap', () => {
    expect(exceedsLikePatternLimit('THEFT')).toBe(false);
  });

  test('a 48-char term fits, 49 does not', () => {
    expect(exceedsLikePatternLimit('a'.repeat(48))).toBe(false);
    expect(exceedsLikePatternLimit('a'.repeat(49))).toBe(true);
  });

  test('escaping counts toward the limit', () => {
    // 25 literal '%' escape to 50 chars, +2 wildcards = 52 > 50, even though the
    // raw term is only 25 characters. escapeLike makes patterns LONGER.
    const term = '%'.repeat(25);
    expect(term.length).toBeLessThan(D1_LIKE_PATTERN_LIMIT);
    expect(escapeLike(term).length).toBe(50);
    expect(exceedsLikePatternLimit(term)).toBe(true);
  });
});

describe('containsClause', () => {
  test('emits an instr() test, not a LIKE pattern', () => {
    const c = containsClause('short_title');
    expect(c.sql).toBe('instr(lower(short_title), lower(?)) > 0');
    expect(c.sql).not.toContain('LIKE');
  });

  test('binds the raw term — no wildcards, no escaping', () => {
    const c = containsClause('short_title');
    expect(c.bind(REAL_CHARGE)).toBe(REAL_CHARGE);
    expect(c.bind(REAL_CHARGE)).not.toContain('%');
  });

  test('length is irrelevant — the cap does not apply to instr()', () => {
    const c = containsClause('description');
    const huge = 'x'.repeat(5000);
    expect(c.bind(huge)).toBe(huge);
  });

  test('wildcard characters are matched literally', () => {
    // With LIKE this needed escapeLike; instr() matches '%' as a plain char.
    const c = containsClause('name');
    expect(c.bind('50%')).toBe('50%');
  });
});

describe('containedByClause', () => {
  test('reverses the operands', () => {
    expect(containedByClause('short_title').sql)
      .toBe('instr(lower(?), lower(short_title)) > 0');
  });

  test('is safe when the COLUMN holds long values', () => {
    // The old form built the pattern from table data
    // (`? LIKE '%' || short_title || '%'`), so one long row broke every caller.
    // utah_statutes.short_title reaches 292 chars on live.
    const c = containedByClause('short_title');
    expect(c.sql).not.toContain('||');
    expect(c.bind(REAL_CHARGE)).toBe(REAL_CHARGE);
  });
});

describe('containsAnyClause', () => {
  test('ORs every column and binds the term once per column', () => {
    const m = containsAnyClause(['last_name', 'first_name', 'phone']);
    expect(m.sql).toBe(
      '(instr(lower(last_name), lower(?)) > 0 OR ' +
      'instr(lower(first_name), lower(?)) > 0 OR ' +
      'instr(lower(phone), lower(?)) > 0)'
    );
    expect(m.binds('smith')).toEqual(['smith', 'smith', 'smith']);
  });

  test('bind count always matches placeholder count', () => {
    for (const cols of [['a'], ['a', 'b'], ['a', 'b', 'c', 'd']]) {
      const m = containsAnyClause(cols);
      const placeholders = (m.sql.match(/\?/g) || []).length;
      expect(m.binds('q')).toHaveLength(placeholders);
    }
  });

  test('supports SQL expressions, not just bare columns', () => {
    const m = containsAnyClause(["first_name || ' ' || last_name"]);
    expect(m.sql).toContain("instr(lower(first_name || ' ' || last_name), lower(?)) > 0");
  });
});

// ── Byte-vs-character, and the uncapped codedLike ──────────────────────────
//
// SQLite checks SQLITE_LIMIT_LIKE_PATTERN_LENGTH against sqlite3_value_bytes(),
// so the cap is on BYTES. The original helpers measured UTF-16 units, which is
// the same number only for ASCII: 30 accented characters escape to 30 chars but
// 60 bytes and still blow the cap.
describe('the cap is measured in bytes', () => {
  test('both modules agree on the limit', () => {
    expect(D1_LIKE_PATTERN_LIMIT).toBe(D1_LIKE_MAX_BYTES);
  });

  test('cappedLikePattern keeps a non-ASCII pattern inside the cap', () => {
    for (const ch of ['é', 'ñ', '—', '🚓']) {
      const pattern = cappedLikePattern(ch.repeat(100));
      expect(byteLen(pattern), `char=${ch}`).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
    }
  });

  test('cappedLikePattern still caps plain ASCII', () => {
    expect(byteLen(cappedLikePattern('a'.repeat(200)))).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
  });

  test('cappedLikePattern still escapes metacharacters', () => {
    expect(cappedLikePattern('50%')).toBe('%50\\%%');
  });

  // Regression: the cut must never leave a lone '\', which SQLite rejects
  // under `ESCAPE '\'` rather than treating as a literal backslash.
  test('cappedLikePattern never leaves a dangling escape', () => {
    for (let prefix = 0; prefix <= 60; prefix++) {
      const needle = cappedLikePattern(`${'a'.repeat(prefix)}${'%'.repeat(10)}`).slice(1, -1);
      const backslashes = (needle.match(/\\/g) ?? []).length;
      expect(backslashes, `prefix=${prefix}`).toBe((needle.match(/\\%/g) ?? []).length);
    }
  });

  test('exceedsLikePatternLimit counts bytes', () => {
    // 30 accented characters: under the cap by character count, over by bytes.
    const accented = 'é'.repeat(30);
    expect(accented.length).toBeLessThan(D1_LIKE_PATTERN_LIMIT - 2);
    expect(exceedsLikePatternLimit(accented)).toBe(true);
  });
});

// codedLike built `%${escapeLike(c)}%` with NO cap. knowledgeBase.ts and
// records.ts pass the raw query term straight in, so a long incident_type
// search threw; useOfForce.ts and connections.ts only avoided it by slicing
// their input to 40 characters first, which is still wrong for non-ASCII.
describe('codedLike binds respect the cap', () => {
  test('every bind fits for a long ASCII term', () => {
    const { sql, binds } = codedLike('incident_type', REAL_CHARGE);
    expect(binds.length).toBeGreaterThan(0);
    expect(binds).toHaveLength((sql.match(/\?/g) ?? []).length);
    for (const b of binds) expect(byteLen(b)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
  });

  test('every bind fits for a long non-ASCII term', () => {
    const { binds } = codedLike('incident_type', 'Café Réunion Incident — '.repeat(6));
    for (const b of binds) expect(byteLen(b)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
  });

  test('every bind fits for an all-metacharacter term', () => {
    const { binds } = codedLike('incident_type', '%'.repeat(80));
    for (const b of binds) expect(byteLen(b)).toBeLessThanOrEqual(D1_LIKE_MAX_BYTES);
  });

  test('short coded terms are untouched, so enum matching still works', () => {
    const { sql, binds } = codedLike('incident_type', 'Traffic Stop');
    expect(sql).toBe("(incident_type LIKE ? ESCAPE '\\' OR incident_type LIKE ? ESCAPE '\\')");
    // The snake_case candidate's '_' is escaped -- as it must be, since a bare
    // '_' is LIKE's single-character wildcard. This matches the pre-existing
    // behaviour; only the cap changed.
    expect(binds).toEqual(['%Traffic Stop%', '%traffic\\_stop%']);
  });

  test('the reverse-mapped enum codes still come through', () => {
    expect(codedLike('priority', 'emergency').binds).toContain('%P1%');
  });

  test('an empty term is still a never-match clause', () => {
    expect(codedLike('incident_type', '  ')).toEqual({ sql: '0', binds: [] });
  });
});
