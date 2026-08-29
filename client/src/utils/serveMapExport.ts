import { jsPDF } from 'jspdf';
import {
  fetchPdfBranding, setActiveBranding, loadPdfAssets,
  setActiveFormKey, setActiveCaseNumber, addPageFooter, stampGenerationTime,
} from './pdfGenerator';
import { LAYOUT, COLOR, FONT } from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';
import { localToday } from './dateUtils';

export interface QueueMapItemForExport {
  id: number;
  recipient_name: string | null;
  recipient_address: string | null;
  priority: string;
  deadline: string | null;
  status?: string | null;
  eta?: string | null;
  bufferMinutes?: number | null;
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

function drawTableRow(
  doc: jsPDF,
  y: number,
  idx: number,
  item: QueueMapItemForExport,
  pageW: number,
): number {
  const lx = LAYOUT.PAGE_MARGIN;
  const rw = pageW - 2 * LAYOUT.PAGE_MARGIN;
  const rowH = 10;
  const cfg = priorityConfig(item.priority);

  // Alternating row tint
  if (idx % 2 === 0) {
    doc.setFillColor(240, 244, 248);
    doc.rect(lx, y, rw, rowH, 'F');
  }

  // Priority badge — left column, 22mm wide
  const badgeW = 22;
  doc.setFillColor(...cfg.bg);
  doc.rect(lx, y, badgeW, rowH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...cfg.text);
  doc.text(cfg.label, lx + badgeW / 2, y + rowH / 2 + 0.8, { align: 'center' });

  // Row number
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(130, 140, 150);
  doc.text(String(idx + 1), lx + badgeW + 3, y + rowH / 2 + 0.8);

  // Recipient name — bold
  const nameX = lx + badgeW + 10;
  const deadlineW = 28;
  const nameW = rw - badgeW - 10 - deadlineW - 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  const nameStr = truncateToFit(doc, item.recipient_name || '(name not set)', nameW);
  doc.text(nameStr, nameX, y + 3.5);

  // Address — smaller, below name
  if (item.recipient_address) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 115, 130);
    doc.text(item.recipient_address, nameX, y + 7.2, { maxWidth: nameW });
  }

  // ETA + buffer — just left of deadline
  if (item.eta || item.bufferMinutes) {
    const etaX = lx + rw - deadlineW - 30;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(90, 100, 115);
    if (item.eta) {
      doc.text(`ETA ${item.eta}`, etaX, y + 3.2);
    }
    if (item.bufferMinutes) {
      doc.text(`~${item.bufferMinutes} min dwell`, etaX, y + 7.2);
    }
  }

  // Deadline or served date — right-aligned
  const dueX = lx + rw - deadlineW;
  if (item.status === 'served') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(34, 139, 34);
    doc.text('SERVED', dueX, y + 5);
  } else if (item.deadline) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(90, 100, 115);
    doc.text('DUE', dueX, y + 3.2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(item.deadline, dueX, y + 7.2);
  }

  // Bottom rule
  doc.setDrawColor(210, 218, 226);
  doc.setLineWidth(0.2);
  doc.line(lx, y + rowH, lx + rw, y + rowH);

  return y + rowH;
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
    doc.text('PRIORITY', lx + 2, y + 4);
    doc.text('#', lx + 24, y + 4);
    doc.text('RECIPIENT / ADDRESS', lx + 32, y + 4);
    doc.text('ETA / DWELL', pageW - lx - 54, y + 4);
    doc.text('DEADLINE', pageW - lx - 24, y + 4);
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
    `${items.length} job${items.length !== 1 ? 's' : ''} total   ·   ${urgentCount} URGENT   ·   ${rushCount} RUSH   ·   ${normalCount} NORMAL   ·   ${routineCount} ROUTINE   ·   Generated ${dateStr}`,
    lx + 3, y + 5,
  );
  y += 10;

  if (items.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(130, 140, 150);
    doc.text('No jobs match the current filter.', lx, y + 8);
    drawFooter(1);
    doc.save(`serve-route-sheet-${dateStr}.pdf`);
    return;
  }

  // Visit order is the drive sequence. Do not re-sort by priority — that
  // printed a different run than the officer is driving.
  const sorted = [...items];

  y = drawColumnHeaders(y);

  // We'll do two passes: first to count pages, then to render.
  // Simpler: estimate rows per page then paginate.
  const footerY = pageH - LAYOUT.PAGE_MARGIN - LAYOUT.FOOTER_HEIGHT - 2;
  const rowH = 10;

  let estimatedPages = 1;
  let simY = y;
  for (let i = 0; i < sorted.length; i++) {
    if (simY + rowH > footerY) { estimatedPages++; simY = drawHeader() + 2; simY = drawColumnHeaders(simY); }
    simY += rowH;
  }

  for (let i = 0; i < sorted.length; i++) {
    if (y + rowH > footerY) {
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
  doc.save(`serve-route-sheet-${dateStr}.pdf`);
}
