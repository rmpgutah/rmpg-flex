// Smoke test for ncicReferencePdf.ts — verify the Operator Reference Guide
// builds without throwing on real code data and produces a multi-page document.
// We use the returnDoc option so jsdom never tries to actually save a file.

import { describe, it, expect } from 'vitest';
import type jsPDF from 'jspdf';
import {
  generateNcicReferencePdf,
  columnXs,
  columnWidth,
  chunkColumns,
  colsForTable,
} from '../ncicReferencePdf';

describe('generateNcicReferencePdf', () => {
  it('builds the guide without throwing and returns a multi-page jsPDF', () => {
    const doc = generateNcicReferencePdf(new Date('2026-06-15'), { returnDoc: true });
    expect(doc).toBeDefined();
    expect(typeof (doc as jsPDF).getNumberOfPages).toBe('function');
    expect((doc as jsPDF).getNumberOfPages()).toBeGreaterThanOrEqual(3);
  });

  it('embeds the Arial font (Identity-H CID font with ToUnicode)', () => {
    const doc = generateNcicReferencePdf(new Date('2026-06-15'), { returnDoc: true }) as jsPDF;
    const bytes = Buffer.from(doc.output('arraybuffer'));
    expect(bytes.includes(Buffer.from('Arial'))).toBe(true);
    expect(bytes.includes(Buffer.from('Identity-H'))).toBe(true);
    expect(bytes.includes(Buffer.from('ToUnicode'))).toBe(true);
  });

  it('does not throw with the default (now) argument', () => {
    expect(() =>
      generateNcicReferencePdf(undefined, { returnDoc: true }),
    ).not.toThrow();
  });
});

describe('layout helpers', () => {
  it('colsForTable scales with row count', () => {
    expect(colsForTable(5)).toBe(2);
    expect(colsForTable(40)).toBe(3);
    expect(colsForTable(175)).toBe(4); // VMA
  });

  it('columnXs / columnWidth partition the content width', () => {
    const xs = columnXs(3);
    expect(xs).toHaveLength(3);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect(columnWidth(3)).toBeGreaterThan(0);
  });

  it('chunkColumns is column-major and covers all items', () => {
    const cols = chunkColumns([1, 2, 3, 4, 5], 2);
    expect(cols).toHaveLength(2);
    expect(cols.flat()).toEqual([1, 2, 3, 4, 5]);
    expect(cols[0]).toEqual([1, 2, 3]); // ceil(5/2)=3 per column
  });
});
