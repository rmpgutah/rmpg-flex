import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { drawDefaultFooter } from '../footer';

function getDocText(doc: jsPDF): string {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  return text;
}

describe('Spillman footer', () => {
  it('renders classification + revision + page numbers + form number', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultFooter(doc, {
      pageNumber: 1, totalPages: 4,
      revision: '2026-05',
      formNumber: 'PS-209',
    });
    const text = getDocText(doc);
    expect(text).toContain('LAW ENFORCEMENT SENSITIVE');
    expect(text).toContain('REV');
    expect(text).toContain('2026-05');
    expect(text).toContain('PAGE 1 OF 4');
    expect(text).toContain('PS-209');
  });

  it('omits form number when not provided', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultFooter(doc, {
      pageNumber: 2, totalPages: 3,
      revision: '2026-04',
    });
    const text = getDocText(doc);
    expect(text).toContain('LAW ENFORCEMENT SENSITIVE');
    expect(text).toContain('PAGE 2 OF 3');
    expect(text).not.toMatch(/FORM [A-Z0-9-]+/);
  });

  it('handles totalPages = 1 cleanly', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultFooter(doc, {
      pageNumber: 1, totalPages: 1,
      revision: '2026-05',
      formNumber: 'PS-209',
    });
    expect(getDocText(doc)).toContain('PAGE 1 OF 1');
  });
});
