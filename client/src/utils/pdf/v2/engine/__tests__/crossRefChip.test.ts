import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';
import { drawCrossRefChip } from '../crossRefChip';

function getDocText(doc: jsPDF): string {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  return text;
}

describe('drawCrossRefChip', () => {
  it('renders the ref type (uppercased) and label', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawCrossRefChip(doc, layout, { label: 'Jane Doe (#4021)', refType: 'person' });
    const text = getDocText(doc);
    expect(text).toContain('PERSON');
    // jsPDF escapes literal parentheses inside PDF text-show operators
    // (`(...)  Tj`), so the raw content stream contains `\(` / `\)` rather
    // than the unescaped label. Match the escaped form to still assert the
    // real label text made it into the document.
    expect(text).toContain('Jane Doe \\(#4021\\)');
  });

  it('advances the layout cursor', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const before = layout.cursorY;
    drawCrossRefChip(doc, layout, { label: 'Case 26-CFS00242', refType: 'case' });
    expect(layout.cursorY).toBeGreaterThan(before);
  });

  it('clamps the chip width to the available content area for a long label', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const longLabel = 'a'.repeat(200);
    drawCrossRefChip(doc, layout, { label: longLabel, refType: 'person' });
    // Content width is layout.rightX - layout.leftX; parse the outline
    // rect's x-coordinates from the raw content stream to confirm the
    // chip's right edge doesn't exceed the content area's right margin.
    const ops = (doc.internal.pages[1] as unknown as string[]).join('\n');
    const coords: number[] = [];
    // jsPDF's roundedRect (stroke-only, no fill) emits a series of m/l/c
    // path-construction operators before the final S (stroke) operator.
    // Collect every numeric x-coordinate token from m/l/c lines.
    for (const line of ops.split('\n')) {
      const m = line.match(/^([\d.]+)\s+([\d.]+)\s+[lmc]/);
      if (m) coords.push(parseFloat(m[1]));
    }
    expect(coords.length).toBeGreaterThan(0);
    // jsPDF's internal unit is pt (72pt/inch), doc is constructed with
    // unit:'mm' so layout coordinates are mm; jsPDF converts internally.
    // 1mm = 72/25.4 pt.
    const maxXPt = (layout.rightX) * (72 / 25.4);
    const epsilon = 1; // 1pt rounding tolerance
    for (const x of coords) {
      expect(x).toBeLessThanOrEqual(maxXPt + epsilon);
    }
  });
});
