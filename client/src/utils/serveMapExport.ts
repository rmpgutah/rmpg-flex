import { jsPDF } from 'jspdf';
import {
  fetchPdfBranding, setActiveBranding, loadPdfAssets,
  setActiveFormKey, setActiveCaseNumber, addPageFooter, stampGenerationTime,
} from './pdfGenerator';
import { LAYOUT, COLOR, FONT } from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';
import { localToday } from './dateUtils';
import { openPdfDocument } from './openPdfDocument';

export interface QueueMapItemForExport {
  id: number;
  recipient_name: string | null;
  recipient_address: string | null;
  priority: string;
  deadline: string | null;
  status?: string | null;
  eta?: string | null;
  bufferMinutes?: number | null;
  // Enhanced fields — linked CFS / case data
  case_number?: string | null;
  client_name?: string | null;
  attorney_name?: string | null;
  attorney_phone?: string | null;
  attorney_email?: string | null;
  document_type?: string | null;
  linked_call_number?: string | null;
  call_id?: number | null;
  distanceMiles?: number | null;      // leg distance from previous stop
}

// Priority display config — colour bands match the serve queue UI
const PRIORITY_CONFIG: Record<string, { label: string; bg: [number, number, number]; text: [number, number, number] }> = {
  urgent:  { label: 'URGENT',  bg: [180, 30, 30],   text: [255, 255, 255] },
  rush:    { label: 'RUSH',    bg: [180, 100, 20],  text: [255, 255, 255] },
  normal:  { label: 'NORMAL',  bg: [34, 64, 95],    text: [255, 255, 255] },
  routine: { label: 'ROUTINE', bg: [55, 75, 85],    text: [220, 220, 220] },
};

function priorityConfig(raw: string) {
  return PRIORITY_CONFIG[raw?.toLowerCase()] ?? PRIORITY_CONFIG.routine;
}

function truncateToFit(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && doc.getTextWidth(t + '…') > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

// Row height expanded to fit two detail lines
const ROW_H = 22;

function drawTableRow(
  doc: jsPDF,
  y: number,
  idx: number,
  item: QueueMapItemForExport,
  pageW: number,
): number {
  const lx = LAYOUT.PAGE_MARGIN;
  const rw = pageW - 2 * LAYOUT.PAGE_MARGIN;
  const cfg = priorityConfig(item.priority);

  // Alternating row tint
  if (idx % 2 === 0) {
    doc.setFillColor(240, 244, 248);
    doc.rect(lx, y, rw, ROW_H, 'F');
  }

  // ── Left spine: priority badge (full row height) ──
  const badgeW = 18;
  doc.setFillColor(...cfg.bg);
  doc.rect(lx, y, badgeW, ROW_H, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...cfg.text);
  doc.text(cfg.label, lx + badgeW / 2, y + ROW_H / 2 + 0.8, { align: 'center' });

  // ── Stop # (sequence in drive order) ──
  const seqX = lx + badgeW + 2.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(34, 64, 95);
  doc.text(`#${idx + 1}`, seqX, y + 7);

  // ── Job ID pill (CFS number) ──
  const jobLabel = `JOB ${item.id}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  const jobLabelW = doc.getTextWidth(jobLabel) + 3;
  doc.setFillColor(34, 64, 95);
  doc.roundedRect(seqX, y + 8.5, jobLabelW, 4.5, 0.8, 0.8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(jobLabel, seqX + 1.5, y + 11.8);

  // Linked CFS call number (below job pill)
  if (item.linked_call_number || item.call_id) {
    const cfsLabel = item.linked_call_number
      ? `CFS #${item.linked_call_number}`
      : `CFS #${item.call_id}`;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(80, 100, 120);
    doc.text(cfsLabel, seqX, y + 18.5);
  }

  // ── Distance from previous stop ──
  if (item.distanceMiles != null && item.distanceMiles > 0) {
    const distLabel = `${item.distanceMiles.toFixed(1)} mi`;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(120, 130, 145);
    doc.text(distLabel, seqX, y + 21.5);
  }

  // ── Main content area ──
  const contentX = lx + badgeW + 26;
  const rightColW = 40;
  const contentW = rw - badgeW - 26 - rightColW - 2;

  // Recipient name — bold, line 1
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  const nameStr = truncateToFit(doc, item.recipient_name || '(name not set)', contentW);
  doc.text(nameStr, contentX, y + 4.5);

  // Address — line 2
  if (item.recipient_address) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(90, 105, 120);
    doc.text(truncateToFit(doc, item.recipient_address, contentW), contentX, y + 9);
  }

  // Document type — line 3 (small label + value)
  if (item.document_type) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(110, 120, 135);
    doc.text(`Doc: ${item.document_type}`, contentX, y + 13.2);
  }

  // Case number — line 3 (right of doc type) or standalone line 3
  if (item.case_number) {
    const caseLabel = `Case: ${item.case_number}`;
    const caseX = item.document_type
      ? contentX + Math.min(doc.getTextWidth(`Doc: ${item.document_type}`) + 6, contentW * 0.5)
      : contentX;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(34, 64, 95);
    doc.text(truncateToFit(doc, caseLabel, contentW - (caseX - contentX)), caseX, y + 13.2);
  }

  // Client / attorney — line 4
  const clientParts: string[] = [];
  if (item.client_name) clientParts.push(item.client_name);
  if (item.attorney_name) clientParts.push(`Atty: ${item.attorney_name}`);
  if (clientParts.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(90, 100, 115);
    doc.text(truncateToFit(doc, clientParts.join('  ·  '), contentW), contentX, y + 17.2);
  }

  // Attorney contact (phone / email) — line 5 or same as line 4 if client was empty
  const contactParts: string[] = [];
  if (item.attorney_phone) contactParts.push(item.attorney_phone);
  if (item.attorney_email) contactParts.push(item.attorney_email);
  if (contactParts.length > 0) {
    const contactY = clientParts.length > 0 ? y + 20.8 : y + 17.2;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6);
    doc.setTextColor(70, 90, 115);
    doc.text(truncateToFit(doc, contactParts.join('  ·  '), contentW), contentX, contactY);
  }

  // ── Right column: ETA / deadline / status ──
  const rightX = lx + rw - rightColW;

  if (item.status === 'served') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(34, 139, 34);
    doc.text('SERVED', rightX, y + 7);
  } else {
    // ETA
    if (item.eta) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(90, 100, 115);
      doc.text('ETA', rightX, y + 4);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text(item.eta, rightX, y + 9);
    }

    // Dwell estimate
    if (item.bufferMinutes) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(110, 120, 135);
      doc.text(`~${item.bufferMinutes} min dwell`, rightX, y + 13);
    }

    // Deadline
    if (item.deadline) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(90, 100, 115);
      doc.text('DUE', rightX, y + 17);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text(truncateToFit(doc, item.deadline, rightColW - 1), rightX, y + 21);
    }
  }

  // Bottom rule
  doc.setDrawColor(200, 210, 220);
  doc.setLineWidth(0.25);
  doc.line(lx, y + ROW_H, lx + rw, y + ROW_H);

  return y + ROW_H;
}

export async function exportServeMapSheet(items: QueueMapItemForExport[]): Promise<void> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  setActiveFormKey('serve_route_sheet');
  setActiveCaseNumber('ROUTE');
  stampGenerationTime();

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const lx = LAYOUT.PAGE_MARGIN;

  let pageNum = 1;
  const dateStr = localToday();

  const drawHeader = () => {
    return drawNibrsHeader(doc, {
      stateIdentifier: 'STATE OF UTAH',
      agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
      formTitle: 'PROCESS SERVER ROUTE SHEET',
      formNumber: 'PS-RS',
      caseNumber: dateStr,
      caseNumberLabel: 'DATE',
    });
  };

  const drawFooter = (total: number) => {
    addPageFooter(doc, pageNum, total, 'serve_route_sheet', {
      audienceLabel: 'INTERNAL USE ONLY',
    });
  };

  // Table column header band
  const drawColumnHeaders = (y: number) => {
    const rw = pageW - 2 * lx;
    doc.setFillColor(...COLOR.BG_SECTION_HDR as [number, number, number]);
    doc.rect(lx, y, rw, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_INVERTED as [number, number, number]);
    doc.text('PRI', lx + 2, y + 4);
    doc.text('STOP / JOB', lx + 21, y + 4);
    doc.text('RECIPIENT · ADDRESS · CASE', lx + 48, y + 4);
    doc.text('ETA / DEADLINE', pageW - lx - 36, y + 4);
    return y + 6;
  };

  // ── Page 1 ──
  let y = drawHeader();
  y += 2;

  // Summary banner
  const urgentCount  = items.filter(i => i.priority?.toLowerCase() === 'urgent').length;
  const rushCount    = items.filter(i => i.priority?.toLowerCase() === 'rush').length;
  const normalCount  = items.filter(i => i.priority?.toLowerCase() === 'normal').length;
  const routineCount = items.filter(i => !['urgent','rush','normal'].includes(i.priority?.toLowerCase())).length;

  doc.setFillColor(230, 236, 242);
  doc.rect(lx, y, pageW - 2 * lx, 8, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(
    `${items.length} stop${items.length !== 1 ? 's' : ''} total   ·   ${urgentCount} URGENT   ·   ${rushCount} RUSH   ·   ${normalCount} NORMAL   ·   ${routineCount} ROUTINE   ·   Generated ${dateStr}`,
    lx + 3, y + 5,
  );
  y += 10;

  if (items.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(130, 140, 150);
    doc.text('No jobs match the current filter.', lx, y + 8);
    drawFooter(1);
    openPdfDocument(doc, `serve-route-sheet-${dateStr}.pdf`);
    return;
  }

  // Visit order is the drive sequence. Do not re-sort by priority.
  const sorted = [...items];

  y = drawColumnHeaders(y);

  const footerY = pageH - LAYOUT.PAGE_MARGIN - LAYOUT.FOOTER_HEIGHT - 2;

  let estimatedPages = 1;
  let simY = y;
  for (let i = 0; i < sorted.length; i++) {
    if (simY + ROW_H > footerY) { estimatedPages++; simY = drawHeader() + 2; simY = drawColumnHeaders(simY); }
    simY += ROW_H;
  }

  for (let i = 0; i < sorted.length; i++) {
    if (y + ROW_H > footerY) {
      drawFooter(estimatedPages);
      doc.addPage();
      pageNum++;
      y = drawHeader();
      y += 2;
      y = drawColumnHeaders(y);
    }
    y = drawTableRow(doc, y, i, sorted[i], pageW);
  }

  drawFooter(estimatedPages);
  openPdfDocument(doc, `serve-route-sheet-${dateStr}.pdf`);
}
