// Document PDF — portrait letter, Arial-only (registerArialFont per project rule).
// Body is rendered through the shared addFormattedText so markdown-marker
// formatting (bold/italic/underline/strike + bullet/outline lists) prints
// exactly as it shows on screen.
//
// Page-break contract (verified against pdfGenerator.ts L1784-1789):
//   checkPageBreak() calls pdf.addPage() internally when overflow is detected.
//   addFormattedText detects the new page (curPage !== lastPage) and then calls
//   onPageBreak(y) — passing the new y already returned by checkPageBreak.
//   The callback must NOT call addPage() again; it just returns the y to resume
//   from (after any per-page decoration). We mirror the same pattern used by
//   narrativePageBreak in pdfGenerator.ts (L1938-1953).
import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { addFormattedText } from './pdfGenerator';
import type { DocRecord } from '../types';

export function generateDocumentPdf(
  doc: Pick<
    DocRecord,
    | 'title'
    | 'body'
    | 'status'
    | 'owner_username'
    | 'created_at'
    | 'updated_at'
    | 'finalized_by'
    | 'finalized_at'
    | 'revision'
    | 'links'
  >,
): void {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  registerArialFont(pdf);

  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 18;
  const contentW = pageW - margin * 2;
  let y = margin;

  // Title
  pdf.setFontSize(15);
  pdf.setFont('Arial', 'bold');
  pdf.text(doc.title || 'Untitled document', margin, y);
  y += 7;

  // Metadata band
  pdf.setFontSize(8);
  pdf.setFont('Arial', 'normal');
  pdf.setTextColor(90);
  const meta: string[] = [
    `Status: ${(doc.status || 'draft').toUpperCase()}`,
    `Rev: ${doc.revision ?? 1}`,
    doc.owner_username ? `Owner: ${doc.owner_username}` : '',
    doc.created_at ? `Created: ${doc.created_at}` : '',
    doc.status === 'finalized' && doc.finalized_by
      ? `Finalized by ${doc.finalized_by}${doc.finalized_at ? ' ' + doc.finalized_at : ''}`
      : '',
  ].filter(Boolean);
  const metaLines = pdf.splitTextToSize(meta.join('   |   '), contentW);
  pdf.text(metaLines, margin, y);
  y += metaLines.length * 3.5 + 0.5;

  const linkLabels = (doc.links || []).map((l) => `${l.target_type} #${l.target_id}`);
  if (linkLabels.length) {
    const linkLines = pdf.splitTextToSize(`Linked: ${linkLabels.join(', ')}`, contentW);
    pdf.text(linkLines, margin, y);
    y += linkLines.length * 3.5 + 0.5;
  }

  // Divider
  pdf.setDrawColor(180);
  pdf.line(margin, y, pageW - margin, y);
  y += 6;
  pdf.setTextColor(20);

  // Page-break callback: addFormattedText already called pdf.addPage() via
  // checkPageBreak before invoking this. We simply return the top-of-page y
  // so the body continues from the same margin. (No double-addPage.)
  const onPageBreak = (_newY: number): number => margin;

  // Body — page-break aware via onPageBreak callback
  y = addFormattedText(pdf, doc.body || '', margin, y, contentW, 10, onPageBreak);

  const safe = (doc.title || 'document').replace(/[^\w.-]+/g, '_').slice(0, 60);
  pdf.save(`${safe}.pdf`);
}
