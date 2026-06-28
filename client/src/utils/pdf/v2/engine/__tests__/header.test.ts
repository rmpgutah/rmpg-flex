import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { drawDefaultHeader } from '../header';

function getDocText(doc: jsPDF): string {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  return text;
}

describe('Spillman header', () => {
  it('returns a content-start Y position below the header block', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const y = drawDefaultHeader(
      doc,
      { formNumber: 'PS-209', title: 'CITATION', revision: '2026-05' },
      { caseNumber: '26-CFS00242' },
    );
    expect(y).toBeGreaterThanOrEqual(22);
    expect(y).toBeLessThan(40);
  });

  it('renders agency name + form title + form number', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultHeader(
      doc,
      { formNumber: 'PS-209', title: 'CITATION', revision: '2026-05' },
      {},
    );
    const text = getDocText(doc);
    expect(text).toContain('ROCKY MOUNTAIN PROTECTIVE GROUP');
    expect(text).toContain('CITATION');
    expect(text).toContain('PS-209');
  });

  it('uppercases the title even when given in mixed case', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultHeader(
      doc,
      { formNumber: 'PS-209', title: 'Citation', revision: '2026-05' },
      {},
    );
    const text = getDocText(doc);
    expect(text).toContain('CITATION');
  });

  it('includes case number when provided in context', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultHeader(
      doc,
      { formNumber: 'PS-209', title: 'CITATION', revision: '2026-05' },
      { caseNumber: 'C-26-12345' },
    );
    expect(getDocText(doc)).toContain('C-26-12345');
  });

  it('includes page-of-pages when provided', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultHeader(
      doc,
      { formNumber: 'PS-209', title: 'CITATION', revision: '2026-05' },
      { caseNumber: '1', pageNumber: 2, totalPages: 4 },
    );
    expect(getDocText(doc)).toContain('PAGE 2 OF 4');
  });
});
