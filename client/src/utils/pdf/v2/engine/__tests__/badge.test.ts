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

  it('clamps badge width to the available content area for long labels', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const longLabel = 'a'.repeat(200); // far wider than the page at 7pt bold
    drawBadge(doc, layout, { label: longLabel });

    const maxWidth = layout.rightX - layout.leftX;

    // jsPDF emits the rounded-rect fill as a series of path-construction
    // ops ending in a fill; the straight segments include an `l` (lineto)
    // op whose x-coordinate marks the right edge of the badge. Simpler and
    // more robust: read back the `re`-less roundedRect path's bounding box
    // via the widths jsPDF tracks internally isn't exposed, so instead we
    // parse the moveto/lineto x-coordinates emitted for the rect path and
    // take the max x, comparing it against leftX + maxWidth (in points,
    // since content-stream units are pt while layout units are mm).
    const ops = doc.internal.pages[1].join('\n');
    const ptPerMm = 72 / 25.4;
    const leftXPt = layout.leftX * ptPerMm;
    const maxXPt = (layout.leftX + maxWidth) * ptPerMm;

    const coords: number[] = [];
    const lineRegex = /(-?\d+\.\d+) (-?\d+\.\d+) l/g;
    const moveRegex = /(-?\d+\.\d+) (-?\d+\.\d+) m/g;
    let match: RegExpExecArray | null;
    while ((match = lineRegex.exec(ops)) !== null) coords.push(parseFloat(match[1]));
    while ((match = moveRegex.exec(ops)) !== null) coords.push(parseFloat(match[1]));

    expect(coords.length).toBeGreaterThan(0);
    const rightMostX = Math.max(...coords);

    // The badge's right edge must not extend past the content area's right
    // margin (allow a small epsilon for rounding/curve control points).
    expect(rightMostX).toBeLessThanOrEqual(maxXPt + 1);
    expect(rightMostX).toBeGreaterThan(leftXPt);
    expect(doc.getNumberOfPages()).toBe(1);
  });
});
