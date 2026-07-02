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

  it('wraps to additional rows when there are more images than columns', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const images = Array.from({ length: 5 }, (_, i) => ({
      dataUrl: STUB_IMAGE, width: 100, height: 100, format: 'PNG' as const, name: `photo-${i}.png`,
    }));
    drawPhotoGrid(doc, layout, { images, columns: 2 });

    const buf = new Uint8Array(doc.output('arraybuffer'));
    let text = '';
    for (const b of buf) text += String.fromCharCode(b);
    // 5 images / 2 columns = 3 rows (2,2,1). All 5 captions must appear once —
    // proves no row was skipped or duplicated by the i += columns slicing.
    for (let i = 0; i < 5; i++) {
      expect(text).toContain(`photo-${i}.png`);
    }

    // Each 100x100 image at this page's column width produces a tall enough
    // row that 3 stacked rows overflow onto a second page, while a single
    // row (2 images) fits on one page. Page count is a reliable signal that
    // multiple rows were genuinely laid out — a cursor-delta comparison is
    // NOT reliable here because pageBreakIfNeeded() resets cursorY to the
    // top margin on the new page, which would make a 3-row grid that spans
    // pages look identical in "cursor advance" to a 1-row grid.
    const multiRowPages = doc.getNumberOfPages();

    const singleRowDoc = new jsPDF({ unit: 'mm', format: 'letter' });
    const singleRowLayout = new LayoutEngine(singleRowDoc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawPhotoGrid(singleRowDoc, singleRowLayout, { images: images.slice(0, 2), columns: 2 });
    const singleRowPages = singleRowDoc.getNumberOfPages();

    expect(singleRowPages).toBe(1);
    expect(multiRowPages).toBeGreaterThan(singleRowPages);
  });
});
