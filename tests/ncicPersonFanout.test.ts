// ============================================================
// QH person query — LIMIT 10, and the per-person fan-out runs in parallel
// ============================================================
// The person branch of /records/ncic-query used LIMIT 5 while every sibling
// query used 10, so a common-surname lookup silently returned 5 of N matches.
// For a name lookup at a stop, silently dropping matches is the wrong trade.
//
// The limit could not simply be raised, though: the branch issues TWO
// sub-queries per person (criminal_history + active warrants) and awaited them
// in a sequential for-loop. At LIMIT 5 that was 10 serial D1 round-trips;
// LIMIT 10 would have made it 20 and roughly doubled response time. The
// sequential fan-out is precisely what made the low limit necessary.
//
// So both change together: LIMIT 10 for coverage, Promise.all so wall time
// stays near a single round-trip pair.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', 'src', 'routes', 'records.ts'), 'utf8');
const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

/** The person case only — this file has many other LIMITs. */
const personCase = (() => {
  const start = code.indexOf("case 'person': {");
  const end = code.indexOf("case 'warrant': {", start);
  expect(start, "person case not found").toBeGreaterThan(-1);
  return code.slice(start, end > start ? end : start + 5000);
})();

describe('coverage', () => {
  it('returns up to 10 people, matching every sibling query', () => {
    expect(personCase).toMatch(/ORDER BY last_name, first_name LIMIT 10/);
  });

  it('no longer caps at 5', () => {
    expect(personCase).not.toMatch(/ORDER BY last_name, first_name LIMIT 5\b/);
  });
});

describe('the per-person fan-out does not serialise', () => {
  it('maps persons to parallel work instead of awaiting in a for-loop', () => {
    expect(personCase).toContain('await Promise.all(persons.map(');
    // The sequential form is what doubling the limit would have punished.
    expect(personCase).not.toMatch(/for \(const p of persons\) \{\s*const criminalHistory = await/);
  });

  it('the two sub-queries per person also run together', () => {
    expect(personCase).toMatch(/const \[criminalHistory, warrants\] = await Promise\.all\(\[/);
  });

  it('keeps soft() on each sub-query so one failure degrades to [] for that person', () => {
    // Without soft(), a single rejected sub-query would reject the whole
    // Promise.all and lose every other person's results — a worse failure than
    // the sequential version had.
    expect(personCase).toContain("soft('criminal history'");
    expect(personCase).toContain("soft('warrants'");
  });

  it('still returns one entry per person with both sub-results', () => {
    expect(personCase).toContain('return { person: p, criminalHistory, warrants };');
  });
});
