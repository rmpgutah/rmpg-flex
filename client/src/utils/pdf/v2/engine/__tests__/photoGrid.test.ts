import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';
import { drawPhotoGrid } from '../photoGrid';

// 1x1 transparent PNG, valid base64 data URL — enough for jsPDF's addImage
// to accept without throwing (it doesn't validate pixel content).
const STUB_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('drawPhotoGrid', () => {
  it('advances the layout cursor when given images', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const before = layout.cursorY;
    drawPhotoGrid(doc, layout, {
      images: [
        { dataUrl: STUB_IMAGE, width: 100, height: 100, format: 'PNG', name: 'evidence-1.png' },
        { dataUrl: STUB_IMAGE, width: 100, height: 100, format: 'PNG', name: 'evidence-2.png' },
      ],
      columns: 2,
    });
    expect(layout.cursorY).toBeGreaterThan(before);
  });

  it('is a no-op (no cursor advance) when given an empty image list', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const before = layout.cursorY;
    drawPhotoGrid(doc, layout, { images: [], columns: 2 });
    expect(layout.cursorY).toBe(before);
  });

  it('renders each image name as a caption', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawPhotoGrid(doc, layout, {
      images: [{ dataUrl: STUB_IMAGE, width: 100, height: 100, format: 'PNG', name: 'damage-front.jpg' }],
      columns: 2,
    });
    const buf = new Uint8Array(doc.output('arraybuffer'));
    let text = '';
    for (const b of buf) text += String.fromCharCode(b);
    expect(text).toContain('damage-front.jpg');
  });

  it('clamps a very long caption to the cell width rather than overflowing it', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const longName = 'a'.repeat(200) + '.jpg';
    drawPhotoGrid(doc, layout, {
      images: [{ dataUrl: STUB_IMAGE, width: 100, height: 100, format: 'PNG', name: longName }],
      columns: 1,
    });
    // The full 204-char name should NOT appear verbatim in the content
    // stream if it was clamped to fit the cell width; a truncated prefix
    // should appear instead. This proves the existing splitTextToSize
    // truncation (already in the reference implementation below) is real.
    const buf = new Uint8Array(doc.output('arraybuffer'));
    let text = '';
    for (const b of buf) text += String.fromCharCode(b);
    expect(text).not.toContain(longName);
  });
});
