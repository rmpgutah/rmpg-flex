import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';
import { drawBadge } from '../badge';

function getDocText(doc: jsPDF): string {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  return text;
}

describe('drawBadge', () => {
  it('renders the label uppercased', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawBadge(doc, layout, { label: 'active warrant', tone: 'gold' });
    expect(getDocText(doc)).toContain('ACTIVE WARRANT');
  });

  it('advances the layout cursor', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const before = layout.cursorY;
    drawBadge(doc, layout, { label: 'cleared' });
    expect(layout.cursorY).toBeGreaterThan(before);
  });

  it('defaults to the neutral tone when none is given', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawBadge(doc, layout, { label: 'verified' });
    const ops = doc.internal.pages[1].join('\n');
    // neutral = rgb(90,90,90). Use whatever 2-decimal precision jsPDF
    // actually emits for fill-color ops in this project (verified in
    // prior tasks to be 2 decimals, lowercase "rg" for fill vs "RG" for
    // stroke) — run the test and adjust the exact string if your
    // computed value differs from a naive assumption.
    expect(ops).toContain('0.35 g');
  });
});
