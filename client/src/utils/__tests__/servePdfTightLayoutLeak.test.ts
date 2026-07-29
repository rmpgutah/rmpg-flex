// ============================================================
// servePdfGenerator — module state must not survive a failed render
// ============================================================
// `tightLayout` is a module-scoped `let`. renderReceiptOfService sets it
// true near the top and clears it on its LAST line, with no try/finally
// in between — so a throw anywhere inside that ~470-line render left the
// flag stuck on for the lifetime of the tab, and every subsequent PDF
// (Notice of Attempt, Civil Process Record, both affidavits) rendered
// with compressed spacing.
//
// The four sibling generators each defensively reset the flag on entry.
// That is not a fix, it is four copies of a workaround: it covers exactly
// those four entry points and nothing added later, and it does not help
// any helper that reads the flag between them.
//
// This is a source-shape guard. Actually rendering a receipt needs jsPDF,
// embedded fonts and a full data fixture, and the leak is invisible in a
// single-document test by construction — it only shows up in the SECOND
// document. Asserting the restore is wired to a `finally` is what
// actually protects it.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/utils/servePdfGenerator.ts'),
  'utf8',
);

/** Slice from `start` to the next top-level function/export declaration. */
function fnBody(start: number): string {
  const rest = SRC.slice(start + 1);
  const next = rest.search(/\n(export )?(async )?function /);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Body of `export async function generateReceiptOfService`.
 *
 * MUST stop at the next top-level function of ANY kind, not the next
 * `export`. renderReceiptOfService is declared without `export`, so slicing
 * on `\nexport ` runs straight past the wrapper and swallows the render body
 * — which contains its own `tightLayout = false` tail clear. That made an
 * earlier version of this guard pass even with the finally-restore deleted.
 */
function receiptWrapper(): string {
  const start = SRC.indexOf('export async function generateReceiptOfService');
  expect(start).toBeGreaterThan(-1);
  return fnBody(start);
}

describe('tightLayout cannot leak out of a receipt render', () => {
  it('the wrapper restores it inside a finally, not on the happy path', () => {
    const body = receiptWrapper();
    const finallyIdx = body.indexOf('} finally {');
    expect(finallyIdx).toBeGreaterThan(-1);
    const finallyBlock = body.slice(finallyIdx);
    expect(finallyBlock).toMatch(/tightLayout\s*=\s*false/);
  });

  it('also restores the other two pieces of shared module state', () => {
    const finallyBlock = receiptWrapper().slice(receiptWrapper().indexOf('} finally {'));
    expect(finallyBlock).toContain('setConfidentialWatermarkEnabled(true)');
    expect(finallyBlock).toContain('setActiveBranding(');
  });

  // Guards the reason the leak existed: the render sets the flag itself, so
  // the caller's finally is the only guarantee that it comes back off.
  it('the render sets the flag but the tail clear is not the guarantee', () => {
    const start = SRC.indexOf('async function renderReceiptOfService');
    expect(start).toBeGreaterThan(-1);
    const body = fnBody(start);
    expect(body).toMatch(/tightLayout\s*=\s*true/);
    // The happy-path clear exists but is the LAST statement, unprotected.
    expect(body).toMatch(/tightLayout\s*=\s*false/);
  });

  it('keeps the sibling generators defensive resets', () => {
    // Belt-and-braces. Removing these is a separate change with its own risk;
    // this pins that they are still present so the guarantee is not weakened
    // by deleting them in the same breath as adding the finally.
    for (const fn of [
      'generateAffidavitOfService',
      'generateAffidavitOfNonService',
      'generateNoticeOfAttempt',
      'generateServiceLog',
    ]) {
      const start = SRC.indexOf(`export async function ${fn}`);
      expect(start, `${fn} not found`).toBeGreaterThan(-1);
      expect(fnBody(start), `${fn} lost its defensive reset`)
        .toMatch(/tightLayout\s*=\s*false/);
    }
  });
});
