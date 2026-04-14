import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { drawDefaultHeader } from '../header';

describe('drawDefaultHeader', () => {
  it('returns a y-offset greater than 0', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const y = drawDefaultHeader(doc, { formNumber: 'PS-101', title: 'TEST', revision: '2026-04' }, { caseNumber: 'C-1' });
    expect(y).toBeGreaterThan(0);
  });

  it('does not throw when caseNumber is omitted', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    expect(() => drawDefaultHeader(doc, { formNumber: 'PS-101', title: 'TEST', revision: '2026-04' }, {})).not.toThrow();
  });
});
