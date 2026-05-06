import type jsPDF from 'jspdf';
import { TYPOGRAPHY, TONES } from './style';

/**
 * Shared diagonal watermark renderer. Lines are stacked vertically around
 * the page center and rotated -45° as a single overlay. Used for both the
 * "BLANK FORM / FOR FIELD USE" and "DRAFT" variants.
 */
function drawDiagonalWatermark(doc: jsPDF, lines: string[]): void {
  doc.saveGraphicsState();
  doc.setTextColor(TONES.watermark);
  doc.setFont('helvetica', TYPOGRAPHY.watermark.weight);
  doc.setFontSize(TYPOGRAPHY.watermark.size);
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const cx = w / 2;
  const cy = h / 2;
  // 0.45× font-size feels right for a 2-line "BLANK FORM / FOR FIELD
  // USE" stack and stays compact for the single-word "DRAFT" case.
  const lineSpacing = TYPOGRAPHY.watermark.size * 0.45;
  const startOffset = -((lines.length - 1) / 2) * lineSpacing;
  for (let i = 0; i < lines.length; i++) {
    const y = cy + startOffset + i * lineSpacing;
    doc.text(lines[i], cx, y, { align: 'center', angle: -45 });
  }
  doc.restoreGraphicsState();
  doc.setTextColor('#000000');
}

export function drawBlankFormWatermark(doc: jsPDF): void {
  drawDiagonalWatermark(doc, ['BLANK FORM', 'FOR FIELD USE']);
}

export function drawDraftWatermark(doc: jsPDF): void {
  drawDiagonalWatermark(doc, ['DRAFT']);
}
