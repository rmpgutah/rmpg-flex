import type jsPDF from 'jspdf';
import type { FormMeta } from './types';

const AGENCY_NAME = 'ROCKY MOUNTAIN PROTECTIVE GROUP';

export interface HeaderOptions {
  caseNumber?: string;
}

export function drawDefaultHeader(doc: jsPDF, meta: FormMeta, opts: HeaderOptions): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const leftX = 40;
  const rightX = pageWidth - 40;
  const topY = 36;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(AGENCY_NAME, leftX, topY);

  doc.setFontSize(14);
  doc.text(meta.title, leftX, topY + 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(`Form ${meta.formNumber}`, rightX, topY, { align: 'right' });
  doc.text(`Rev ${meta.revision}`, rightX, topY + 12, { align: 'right' });
  if (opts.caseNumber) {
    doc.text(`Case # ${opts.caseNumber}`, rightX, topY + 24, { align: 'right' });
  }

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.75);
  doc.line(leftX, topY + 32, rightX, topY + 32);

  return topY + 40;
}
