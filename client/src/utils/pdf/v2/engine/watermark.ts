import type jsPDF from 'jspdf';

/**
 * Diagonal "BLANK FORM / FOR FIELD USE" watermark, centered on the page.
 * Mirrors v1's `addBlankFormWatermark` in blankFormPdfGenerator.ts.
 * Assumes the doc is in mm units.
 */
export function drawBlankFormWatermark(doc: jsPDF): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 0.06 }));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(48);
  doc.setTextColor(0, 0, 0);
  doc.text('BLANK FORM', pageW / 2, pageH / 2 - 10, { align: 'center', angle: 45 });
  doc.setFontSize(20);
  doc.text('FOR FIELD USE', pageW / 2, pageH / 2 + 10, { align: 'center', angle: 45 });
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));
}
