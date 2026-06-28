import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { fitTextToWidth } from '../pdfFormHelpers';

/**
 * fitTextToWidth is the keystone fix for the "overlapping text" defect in
 * generated records: long form-cell values must be fit to ONE line (shrink,
 * then ellipsis) instead of wrapped past a fixed-height cell into the next row.
 */
describe('fitTextToWidth', () => {
  function newDoc() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    doc.setFont('helvetica', 'normal');
    return doc;
  }

  it('leaves text and font size untouched when it already fits', () => {
    const doc = newDoc();
    const r = fitTextToWidth(doc, 'SHORT', 80, 8.5);
    expect(r.text).toBe('SHORT');
    expect(r.fontSize).toBe(8.5);
  });

  it('shrinks the font so a long value fits on one line within the cell width', () => {
    const doc = newDoc();
    const longAddr = '4501 SOUTH CONSTITUTION BOULEVARD, TAYLORSVILLE, UTAH 84129, UNITED STATES';
    const maxW = 120; // mm — the real TARGET ADDRESS cell width (ratio 2.6 of the grid)
    const r = fitTextToWidth(doc, longAddr, maxW, 8.5);

    expect(r.fontSize).toBeLessThan(8.5);      // it shrank
    expect(r.text).toBe(longAddr);             // no data lost — full address still fits
    // Verify the rendered width actually fits the cell at the returned size.
    doc.setFontSize(r.fontSize);
    expect(doc.getTextWidth(r.text)).toBeLessThanOrEqual(maxW);
  });

  it('ellipsis-truncates as a last resort when it cannot fit even at the floor', () => {
    const doc = newDoc();
    const huge = 'X'.repeat(400);
    const maxW = 12; // mm — too narrow for 400 chars even at the 5pt floor
    const r = fitTextToWidth(doc, huge, maxW, 8.5, 5);

    expect(r.fontSize).toBe(5);                // hit the floor
    expect(r.text.endsWith('...')).toBe(true); // truncated rather than overflow
    doc.setFontSize(r.fontSize);
    expect(doc.getTextWidth(r.text)).toBeLessThanOrEqual(maxW); // never crosses the cell edge
  });

  it('is a no-op for empty text or non-positive width', () => {
    const doc = newDoc();
    expect(fitTextToWidth(doc, '', 50, 8.5)).toEqual({ text: '', fontSize: 8.5 });
    expect(fitTextToWidth(doc, 'ANYTHING', 0, 8.5)).toEqual({ text: 'ANYTHING', fontSize: 8.5 });
  });
});
