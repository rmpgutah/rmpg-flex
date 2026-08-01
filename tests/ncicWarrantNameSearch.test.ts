// ============================================================
// NCIC `QW` — a warrant must be findable by the name ON THE WARRANT
// ============================================================
// The warrant branch of /records/ncic-query matched only:
//     w.warrant_number, p.first_name, p.last_name, "p.last_name || ', ' || p.first_name"
//
// Every p.* column comes from a LEFT JOIN on persons via subject_person_id. A
// warrant whose subject was never linked to a persons row has NULL for all of
// them, so it was unreachable by name -- even though the warrant itself carries
// subject_name / subject_first_name / subject_last_name.
//
// Measured on live D1 (2026-08-01): 19 of the 21 ACTIVE warrants are unlinked,
// and ALL 19 carry a subject name. `QW GONZALEZ` in the live terminal returned
// 1 of 9 active Gonzalez warrants -- and that single hit was coincidence: the
// warrant_number "natrona-county-wy-natrona:gonz…" happens to contain "gonz".
// Every other subject answered NO RECORD FOUND while holding a live arrest
// warrant.
//
// Old matcher vs new, run against live D1: 1 hit -> 9 hits.
//
// Second defect in the same query: the SELECT aliased `p.last_name AS
// subject_last_name`, SHADOWING the warrant's own column. An unlinked hit came
// back with a NULL name, and ncicFormatter only emits the NAM/ line when
// subject_last_name is truthy -- so an officer saw a warrant hit with no
// indication of WHO it was for.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', 'src', 'routes', 'records.ts'), 'utf8');
// This file's own comments name the columns under test, so strip them —
// otherwise the assertions pass on prose after the code is removed.
const code = src
  .split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--'))
  .join('\n');

/** The warrant branch only, so a match elsewhere in this 3k-line file can't satisfy these. */
const warrantCase = (() => {
  const start = code.indexOf("case 'warrant': {");
  const end = code.indexOf("case 'vehicle': {", start);
  expect(start, "warrant case not found").toBeGreaterThan(-1);
  return code.slice(start, end > start ? end : start + 4000);
})();

/**
 * The `nq(...)` MATCHER ARGUMENTS only — not the whole case block.
 *
 * Scoping matters: `w.subject_first_name` / `w.subject_last_name` also appear
 * in the SELECT's COALESCE fallback, so asserting against the whole block let
 * these tests pass with the matcher fully reverted. Verified by mutation —
 * that reverted state produced 1 failure instead of 4 until this was scoped.
 */
const matcher = (() => {
  const start = warrantCase.indexOf('const mw = nq(');
  expect(start, 'matcher not found').toBeGreaterThan(-1);
  return warrantCase.slice(start, warrantCase.indexOf(');', start) + 2);
})();

describe('QW matches the name recorded ON the warrant', () => {
  for (const col of ['w.subject_name', 'w.subject_first_name', 'w.subject_last_name']) {
    it(`the matcher searches ${col}`, () => {
      expect(matcher).toContain(col);
    });
  }

  it('still searches the warrant number and the linked person', () => {
    // Purely additive — the previous behaviour must be preserved, not replaced.
    expect(matcher).toContain('w.warrant_number');
    expect(matcher).toContain('p.first_name');
    expect(matcher).toContain('p.last_name');
  });

  it('supports "Last, First" against the warrant\'s own fields', () => {
    // Live subject_name values are stored that way ("Gonzalez, Adrian").
    expect(matcher).toContain(
      "COALESCE(w.subject_last_name,'') || ', ' || COALESCE(w.subject_first_name,'')",
    );
  });
});

describe('an unlinked hit still reports WHO the warrant is for', () => {
  it('falls back to the warrant\'s own name instead of shadowing it with NULL', () => {
    expect(warrantCase).toContain('COALESCE(p.first_name, w.subject_first_name) AS subject_first_name');
    expect(warrantCase).toContain('COALESCE(p.last_name, w.subject_last_name, w.subject_name) AS subject_last_name');
  });

  it('no longer aliases the person columns bare', () => {
    // `p.last_name AS subject_last_name` is what shadowed the warrant's column.
    expect(warrantCase).not.toMatch(/\bp\.last_name AS subject_last_name/);
    expect(warrantCase).not.toMatch(/\bp\.first_name AS subject_first_name/);
  });
});

describe('scope is unchanged', () => {
  it('still returns active warrants only', () => {
    expect(warrantCase).toContain("w.status = 'active'");
  });

  it('keeps the LEFT JOIN so linked persons still resolve', () => {
    // An INNER JOIN here would re-create the original bug in the opposite
    // direction: unlinked warrants would vanish entirely.
    expect(warrantCase).toContain('LEFT JOIN persons p ON p.id = w.subject_person_id');
  });
});
