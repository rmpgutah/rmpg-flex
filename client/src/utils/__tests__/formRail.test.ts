// ============================================================
// The rail — one left edge and one width for full-bleed blocks
// ============================================================
// Section header bars are drawn at PAGE_MARGIN across getContentWidth
// (12.7 -> 185.9 on letter; PAGE_MARGIN updated to 0.5 in / 12.7 mm by
// fix(pdf): #3742). Blocks that instead used getLeftX() /
// getFullFieldWidth() landed at 11 -> 204.9, inset a millimetre on BOTH
// sides. Worse, the I(a)/I(b) panel pair was SIZED from getContentWidth but
// DRAWN from getLeftX, so it overshot the right rail by a millimetre at
// 206.9 -- wider than the bars above and below it.
//
// Three different edges stacked down one page read as a wobbling margin,
// which is what "fix side to side alignment" was pointing at.
//
// getLeftX() is still correct for TEXT inside a block. These helpers are for
// the block itself.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jsPDF from 'jspdf';
import { getRailX, getRailWidth, getContentWidth, getLeftX, getFullFieldWidth } from '../pdfTokens';

const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

describe('rail geometry', () => {
  it('matches the rails a section header bar is drawn on', () => {
    expect(getRailX()).toBe(12.7); // 0.5 in, updated by fix(pdf) #3742
    expect(getRailWidth(doc)).toBeCloseTo(getContentWidth(doc), 5);
  });

  it('is strictly wider than the text inset it replaced', () => {
    // The old block geometry: getLeftX() .. getLeftX() + getFullFieldWidth().
    expect(getLeftX()).toBeGreaterThan(getRailX());
    expect(getLeftX() + getFullFieldWidth(doc)).toBeLessThan(getRailX() + getRailWidth(doc));
  });

  it('a half-panel pair plus its gutter lands exactly on the right rail', () => {
    // This is the arithmetic that overshot: sized from the content width but
    // drawn from the text inset.
    const gutter = 1;
    const panelW = (getRailWidth(doc) - gutter) / 2;
    const rightEdge = getRailX() + panelW + gutter + panelW;
    expect(rightEdge).toBeCloseTo(getRailX() + getRailWidth(doc), 5);
  });
});

describe('serve forms draw full-bleed blocks on the rail', () => {
  const src = readFileSync(join(__dirname, '..', 'servePdfGenerator.ts'), 'utf8');

  it('no signature block is placed with the text inset', () => {
    expect(src).not.toMatch(/addSignatureBlock\([^)]*\blx, y, ffw/);
    expect(src).toContain('getRailX(), y, getRailWidth(doc)');
  });

  it('subject panels are sized and drawn from the same origin', () => {
    expect(src).toContain('const panelW = (getRailWidth(doc) - gutter) / 2;');
    expect(src).toContain('drawSubjectPanel(doc, railX, startY, panelW');
  });
});
