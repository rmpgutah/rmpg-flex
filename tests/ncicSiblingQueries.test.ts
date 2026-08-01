// ============================================================
// NCIC QH / QT — the same "matcher names fewer columns than the data" defect
// ============================================================
// #3222 fixed QW: the warrant matcher searched w.warrant_number and the joined
// person, but never the warrant's OWN subject_name, so 19 of 21 active warrants
// were unreachable by name. That is a CLASS, not a one-off — every sibling
// query in /records/ncic-query is built the same way, so they were audited too.
//
// QH (person) searched first_name/last_name only:
//   - alias_nickname (4 persons on live) and aliases (1) were unreachable, even
//     though records.ts already exposes a /persons/alias-search endpoint. A
//     subject known to officers by a nickname answered NO RECORD FOUND.
//   - middle_name (43 persons on live) was unreachable.
//   Verified against live D1 — 'NIKITA', 'BRAYDEN' and 'WRIGHT' each returned
//   0 under the old matcher and 1 under the new one.
//
// QT (phone) searched `phone` while persons stores FOUR phone columns. Live: 4
// have phone_secondary, 4 home_phone, 3 work_phone, and 2 persons have ONLY a
// non-primary number — dialling a number that is on file returned NO RECORD.
//
// Both changes are purely additive: they can only return MORE matches.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', 'src', 'routes', 'records.ts'), 'utf8');
const code = src
  .split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--'))
  .join('\n');

/**
 * Extract one case's `nq(...)` ARGUMENTS.
 *
 * Scoped to the matcher, not the case block — #3222 learned this the hard way:
 * the columns also appear in SELECT clauses, so block-scoped assertions passed
 * with the matcher fully reverted.
 */
function matcherFor(caseName: string, nextCase: string): string {
  const start = code.indexOf(`case '${caseName}': {`);
  expect(start, `case '${caseName}' not found`).toBeGreaterThan(-1);
  const end = code.indexOf(`case '${nextCase}': {`, start);
  const block = code.slice(start, end > start ? end : start + 5000);
  const nqAt = block.indexOf('nq(');
  expect(nqAt, `no nq() in case '${caseName}'`).toBeGreaterThan(-1);
  return block.slice(nqAt, block.indexOf(');', nqAt) + 2);
}

describe('QH person query reaches aliases and middle names', () => {
  const mp = matcherFor('person', 'warrant');

  for (const col of ['alias_nickname', 'aliases', 'middle_name']) {
    it(`searches ${col}`, () => {
      expect(mp).toContain(col);
    });
  }

  it('still searches the legal first/last name', () => {
    // Additive only — the original behaviour must survive.
    expect(mp).toContain('first_name');
    expect(mp).toContain('last_name');
    expect(mp).toContain("first_name || ' ' || last_name");
    expect(mp).toContain("last_name || ', ' || first_name");
  });

  it('supports a full name typed WITH the middle name', () => {
    expect(mp).toContain("first_name || ' ' || COALESCE(middle_name,'') || ' ' || last_name");
  });
});

describe('QT phone query reaches every stored number', () => {
  const mph = matcherFor('phone', 'address');

  for (const col of ['phone', 'phone_secondary', 'home_phone', 'work_phone']) {
    it(`searches ${col}`, () => {
      expect(mph).toContain(col);
    });
  }
});

describe('the QW fix from #3222 has not regressed', () => {
  const mw = matcherFor('warrant', 'vehicle');

  it('still matches the name recorded on the warrant itself', () => {
    for (const col of ['w.subject_name', 'w.subject_first_name', 'w.subject_last_name']) {
      expect(mw).toContain(col);
    }
  });
});
