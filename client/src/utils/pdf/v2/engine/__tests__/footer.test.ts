import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { drawDefaultFooter } from '../footer';

describe('drawDefaultFooter', () => {
  it('does not throw for page 1 of 1', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    expect(() => drawDefaultFooter(doc, { pageNumber: 1, totalPages: 1, revision: '2026-04' })).not.toThrow();
  });
});
