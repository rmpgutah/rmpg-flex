import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { drawSectionHeader } from '../context';
import { LayoutEngine } from '../layout';

function getDocText(doc: jsPDF): string {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  return text;
}

describe('section header (Spillman style)', () => {
  it('renders title in UPPERCASE', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
    drawSectionHeader(doc, layout, 'subject information');
    expect(getDocText(doc)).toContain('SUBJECT INFORMATION');
  });

  it('advances the layout cursor', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
    const before = layout.cursorY;
    drawSectionHeader(doc, layout, 'BASIC');
    expect(layout.cursorY).toBeGreaterThan(before);
  });

  it('preserves an already-uppercase title', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
    drawSectionHeader(doc, layout, 'CITATION INFORMATION');
    expect(getDocText(doc)).toContain('CITATION INFORMATION');
  });
});
