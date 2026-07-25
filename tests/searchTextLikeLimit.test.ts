import { describe, test, expect } from 'vitest';
import {
  D1_LIKE_PATTERN_LIMIT,
  escapeLike,
  exceedsLikePatternLimit,
  containsClause,
  containedByClause,
  containsAnyClause,
} from '../src/utils/searchText';

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
