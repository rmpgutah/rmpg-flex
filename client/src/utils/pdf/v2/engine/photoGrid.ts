import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import type { ResolvedImage } from '../../pdfImageHelpers';

export interface PhotoGridOptions {
  images: ResolvedImage[];
  columns: number;
}

const CELL_GAP = 3;       // mm, between grid cells
const CAPTION_HEIGHT = 4; // mm, reserved below each photo for its filename
const CAPTION_FONT_SIZE = 6.5;
const GAP_BELOW = 2;      // mm, after the whole grid

/**
 * Lays out already-resolved images (see pdfImageHelpers.ts for fetch/
 * downscale) in a captioned grid — e.g. evidence photos, damage photos,
 * mugshot arrays. Cell height is derived from each image's own aspect
 * ratio so portrait and landscape photos in the same grid don't distort.
 * Captions are clamped to the cell width via splitTextToSize (same
 * pattern as badge.ts/crossRefChip.ts's label clamps).
 */
export function drawPhotoGrid(doc: jsPDF, layout: LayoutEngine, opts: PhotoGridOptions): void {
  const { images, columns } = opts;
  if (images.length === 0) return;

  const totalWidth = layout.rightX - layout.leftX;
  const cellWidth = (totalWidth - CELL_GAP * (columns - 1)) / columns;

  for (let i = 0; i < images.length; i += columns) {
    const rowImages = images.slice(i, i + columns);
    const rowHeights = rowImages.map((img) => (cellWidth * img.height) / img.width);
    const rowHeight = Math.max(...rowHeights);

    layout.pageBreakIfNeeded(rowHeight + CAPTION_HEIGHT + CELL_GAP);
    const y = layout.cursorY;

    rowImages.forEach((img, col) => {
      const x = layout.leftX + col * (cellWidth + CELL_GAP);
      const h = (cellWidth * img.height) / img.width;
      try {
        doc.addImage(img.dataUrl, img.format, x, y, cellWidth, h);
      } catch {
        /* ignore malformed image, leave the cell blank */
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(CAPTION_FONT_SIZE);
      doc.setTextColor(100, 100, 100);
      const caption = doc.splitTextToSize(img.name, cellWidth)[0] ?? img.name;
      doc.text(caption, x, y + rowHeight + CAPTION_HEIGHT - 1);
      // Reset to default text color — matches the established convention
      // in header.ts/context.ts/primitives.ts/badge.ts/severityMeter.ts/crossRefChip.ts.
      doc.setTextColor(0, 0, 0);
    });

    layout.advance(rowHeight + CAPTION_HEIGHT + CELL_GAP);
  }

  layout.advance(GAP_BELOW - CELL_GAP);
}
