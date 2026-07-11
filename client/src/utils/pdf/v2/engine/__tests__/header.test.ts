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

  it('draws the top rule in the steel-blue accent, not black', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultHeader(
      doc,
      { formNumber: 'PS-209', title: 'CITATION', revision: '2026-05' },
      {},
    );
    const ops = (doc.internal.pages[1] as unknown as string[]).join('\n');
    // jsPDF content streams encode RGB draw color as "r g b RG" (0-1 scale,
    // rounded to jsPDF's default 2-decimal precision).
    // #2c4256 = 44,66,86 -> 0.17, 0.26, 0.34
    expect(ops).toContain('0.17 0.26 0.34 RG');
  });

  it('embeds the emblem image when logoBase64 is provided', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    // 1x1 transparent PNG — valid enough for jsPDF's addImage to accept.
    const stubLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    drawDefaultHeader(
      doc,
      { formNumber: 'PS-209', title: 'CITATION', revision: '2026-05' },
      { logoBase64: stubLogo },
    );
    const ops = (doc.internal.pages[1] as unknown as string[]).join('\n');
    expect(ops).toMatch(/\/I\d+ Do/); // jsPDF's image-XObject draw operator
  });

  it('omits the image draw operator when logoBase64 is not provided', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultHeader(
      doc,
      { formNumber: 'PS-209', title: 'CITATION', revision: '2026-05' },
      {},
    );
    const ops = (doc.internal.pages[1] as unknown as string[]).join('\n');
    expect(ops).not.toMatch(/\/I\d+ Do/);
  });
});
