import type jsPDF from 'jspdf';

export interface FooterOptions {
  pageNumber: number;
  totalPages: number;
  revision: string;
}

export function drawDefaultFooter(doc: jsPDF, opts: FooterOptions): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 24;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated ${new Date().toISOString().split('T')[0]} • Rev ${opts.revision}`, 40, footerY);
  doc.text(`Page ${opts.pageNumber} of ${opts.totalPages}`, pageWidth - 40, footerY, { align: 'right' });
}
