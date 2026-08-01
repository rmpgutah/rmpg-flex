import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import {
  extractPdfText,
  findPlaceholderLeaks,
  expectNoPlaceholderLeaks,
} from '../textLayer';

function docWith(lines: string[]): jsPDF {
  const doc = new jsPDF();
  lines.forEach((line, i) => doc.text(line, 20, 20 + i * 10));
  return doc;
}

describe('extractPdfText', () => {
  it('returns one entry per page', async () => {
    const doc = docWith(['Page one text']);
    doc.addPage();
    doc.text('Page two text', 20, 20);
    const pages = await extractPdfText(doc);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('Page one text');
    expect(pages[1]).toContain('Page two text');
  });
});

describe('findPlaceholderLeaks', () => {
  it('finds undefined, NaN, null, Invalid Date and [object Object]', () => {
    const leaks = findPlaceholderLeaks([
      'Officer: undefined',
      'Mileage: NaN miles',
      'Supervisor: null',
      'Served: Invalid Date',
      'Vehicle: [object Object]',
    ]);
    expect(leaks.map((l) => l.token).sort()).toEqual(
      ['[object Object]', 'Invalid Date', 'NaN', 'null', 'undefined'].sort(),
    );
    expect(leaks[0].page).toBe(1);
  });

  it('does not flag legitimate words containing the tokens', () => {
    const leaks = findPlaceholderLeaks([
      'Annulled by court order',
      'Nullification hearing scheduled',
      'The undefinedness doctrine',
    ]);
    expect(leaks).toEqual([]);
  });

  it('returns surrounding context for each leak', () => {
    const leaks = findPlaceholderLeaks(['Issuing officer: undefined, badge 4417']);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].context).toContain('Issuing officer');
  });

  it('returns empty for clean pages', () => {
    expect(findPlaceholderLeaks(['Rocky Mountain Protective Group'])).toEqual([]);
  });
});

describe('expectNoPlaceholderLeaks', () => {
  it('resolves for a clean document', async () => {
    await expect(
      expectNoPlaceholderLeaks(docWith(['Rocky Mountain Protective Group'])),
    ).resolves.toBeUndefined();
  });

  it('throws naming the page and token', async () => {
    await expect(
      expectNoPlaceholderLeaks(docWith(['Officer: undefined'])),
    ).rejects.toThrow(/page 1.*undefined/is);
  });
});
