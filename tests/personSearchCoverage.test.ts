// ============================================================
// Person search endpoints must cover the columns the data lives in
// ============================================================
// Third instance of the class #3222 and #3223 fixed: a matcher naming fewer
// columns than the table actually stores, so records that ARE present answer
// "no results".
//
// records.ts had THREE person-search paths, each with a different column set:
//
//   /persons/alias-search   first_name, last_name                    <- worst
//   /persons/search         last_name, first_name, phone
//   /persons (bulk list)    first_name, last_name, alias_nickname,
//                           phone, email, dl_number                  <- best
//
// The bulk LIST was the most complete, so the two dedicated SEARCH endpoints —
// the ones an officer actually types into — were the narrowest. And
// alias-search, whose entire purpose is finding people by alias, could not
// match an alias at all: it was functionally a plain name search.
//
// Verified live: 'NIKITA' and 'BRAYDEN' are real alias_nickname values that
// returned 0 rows before and 1 after.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', 'src', 'routes', 'records.ts'), 'utf8');
const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

/**
 * The containsAnyClause([...]) ARGUMENT LIST for a given route.
 *
 * Scoped to the matcher, not the handler — #3222 established why: the same
 * column names appear in SELECT lists, so handler-scoped assertions can pass
 * with the matcher fully reverted.
 */
function matcherFor(routePath: string): string {
  const at = code.indexOf(`records.get('${routePath}'`);
  expect(at, `route ${routePath} not found`).toBeGreaterThan(-1);
  const start = code.indexOf('containsAnyClause([', at);
  expect(start, `no containsAnyClause in ${routePath}`).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf('])', start) + 2);
}

describe('/persons/alias-search actually searches aliases', () => {
  const m = matcherFor('/persons/alias-search');

  for (const col of ['alias_nickname', 'aliases']) {
    it(`searches ${col}`, () => {
      // Without these the endpoint is a plain name search wearing the wrong name.
      expect(m).toContain(col);
    });
  }

  it('still searches the legal name', () => {
    expect(m).toContain('first_name');
    expect(m).toContain('last_name');
  });

  it('returns the matched alias so the caller can see WHY it matched', () => {
    const at = code.indexOf("records.get('/persons/alias-search'");
    const handler = code.slice(at, at + 900);
    expect(handler).toContain('alias_nickname FROM persons');
  });
});

describe('/persons/search covers alias and secondary-contact columns', () => {
  const m = matcherFor('/persons/search');

  for (const col of [
    'alias_nickname', 'aliases', 'middle_name',
    'phone_secondary', 'home_phone', 'work_phone',
    'email', 'dl_number',
  ]) {
    it(`searches ${col}`, () => {
      expect(m).toContain(col);
    });
  }

  it('preserves the original columns', () => {
    // Additive only — no previously-findable person may become unfindable.
    for (const col of ['last_name', 'first_name', 'phone']) {
      expect(m).toContain(col);
    }
  });
});

describe('the dedicated search endpoints are no narrower than the bulk list', () => {
  it('every column the bulk list searches is also searched by /persons/search', () => {
    // The inversion that made this bug possible: the LIST was better than the
    // SEARCH. If that ever reverses again, this fails.
    const bulk = matcherFor('/persons');
    const search = matcherFor('/persons/search');
    for (const col of (bulk.match(/'([a-z_]+)'/g) || [])) {
      expect(search, `bulk list searches ${col} but /persons/search does not`).toContain(col);
    }
  });
});
