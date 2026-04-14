import type jsPDF from 'jspdf';

export interface FooterOptions {
  pageNumber: number;
  totalPages: number;
  revision: string;
}

/**
 * Draw a compact footer with generated-date + revision (left) and page count (right).
 * Assumes doc is in mm units.
 */
export function drawDefaultFooter(doc: jsPDF, opts: FooterOptions): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 8;

  // @ts-expect-error jsPDF GState — keep footer fully opaque even after watermark
  doc.setGState(new doc.GState({ opacity: 1.0 }));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated ${new Date().toISOString().split('T')[0]} • Rev ${opts.revision}`, 10, footerY);
  doc.text(`Page ${opts.pageNumber} of ${opts.totalPages}`, pageWidth - 10, footerY, { align: 'right' });
}
