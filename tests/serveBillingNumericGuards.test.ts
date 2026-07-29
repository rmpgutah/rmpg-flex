// ============================================================
// serveBilling — invalid money must fail loudly, never become $0.00
// ============================================================
// Three writes on this router coerced caller input with `Number(x) || 0`
// or an unguarded `Number(x)`:
//
//   POST /ps-pricing/items      amount, attempts_included, sort_order
//   PUT  /ps-pricing/items/:id  same, with NO guard at all
//   PUT  /serve-charges/:id     per-line quantity, unit_price
//
// `Number('12.5o')` is NaN, and `NaN || 0` is 0 — so a typo created a
// rate that bills NOTHING and returned success. The PUT on the rate card
// had no `|| 0` either, so NaN bound straight into D1 and destroyed a
// value that had been correct.
//
// The charge-lines path was worst: it DELETEs every existing line and
// then rebuilds from the payload, so coercion inside the rebuild loop
// happens after the real lines are already gone — a malformed request
// silently replaced a priced charge with $0.00 rows.
//
// Guard is on the source: exercising these needs a D1 binding, a JWT and
// a seeded rate card, and the failure mode is a SUCCESSFUL response with
// wrong numbers — nothing throws, so a smoke test passes either way.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/routes/serveBilling.ts'), 'utf8');

/**
 * Strip // and comments so negative assertions cannot match prose.
 * The fix's own comments quote the old idiom verbatim to explain it, which
 * made an earlier version of this test fail against the CORRECT code.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

/** Body of a route handler, from its registration to the next one. */
function handler(signature: string): string {
  const start = SRC.indexOf(signature);
  expect(start, `${signature} not found`).toBeGreaterThan(-1);
  const rest = SRC.slice(start + signature.length);
  const next = rest.search(/\npsb\.(get|post|put|delete)\(/);
  return codeOnly(next === -1 ? rest : rest.slice(0, next));
}

describe('serveBilling numeric input guards', () => {
  it('exposes a finite-number parser rather than coercing with || 0', () => {
    expect(SRC).toMatch(/function finiteNumber\(/);
    expect(SRC).toMatch(/Number\.isFinite\(n\)/);
  });

  it('POST /ps-pricing/items rejects a non-numeric amount', () => {
    const h = handler("psb.post('/ps-pricing/items'");
    expect(h).toMatch(/finiteNumber\(b\.amount\)/);
    expect(h).toMatch(/BAD_AMOUNT/);
    // The coercion that turned a typo into a free line item must be gone.
    expect(h).not.toMatch(/Number\(b\.amount\) \|\| 0/);
  });

  it('PUT /ps-pricing/items/:id cannot bind NaN over a good rate', () => {
    const h = handler("psb.put('/ps-pricing/items/:id'");
    expect(h).toMatch(/finiteNumber\(b\.amount\)/);
    expect(h).toMatch(/BAD_AMOUNT/);
    // Previously: `b.amount !== undefined ? Number(b.amount) : before.amount`
    expect(h).not.toMatch(/\? Number\(b\.amount\) :/);
  });

  it('rejects negative money on both rate-card writes', () => {
    for (const sig of ["psb.post('/ps-pricing/items'", "psb.put('/ps-pricing/items/:id'"]) {
      expect(handler(sig), sig).toMatch(/cannot be negative/);
    }
  });

  // The ordering bug: validation must precede the destructive DELETE.
  it('PUT /serve-charges/:id validates every line BEFORE deleting the old ones', () => {
    const h = handler("psb.put('/serve-charges/:id'");
    const validateIdx = h.indexOf('finiteNumber(l?.quantity)');
    const deleteIdx = h.indexOf('DELETE FROM serve_charge_lines');
    expect(validateIdx, 'lines are never validated').toBeGreaterThan(-1);
    expect(deleteIdx, 'delete not found').toBeGreaterThan(-1);
    expect(
      validateIdx,
      'validation runs after the DELETE — the real lines are already gone by then',
    ).toBeLessThan(deleteIdx);
  });

  it('charge lines no longer coerce quantity/unit_price to zero', () => {
    const h = handler("psb.put('/serve-charges/:id'");
    expect(h).not.toMatch(/Number\(l\.quantity\) \|\| 0/);
    expect(h).not.toMatch(/Number\(l\.unit_price\) \|\| 0/);
    expect(h).toMatch(/BAD_LINE/);
  });
});
