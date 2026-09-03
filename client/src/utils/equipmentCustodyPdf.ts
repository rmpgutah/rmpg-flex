// ═══════════════════════════════════════════════════════════════
// Equipment Custody — court-ready issuance / chain-of-custody PDF.
// Equipment issued to an officer (firearm, taser, body camera,
// badge, etc.) is the operator-side analog to evidence-room
// custody — when a use-of-force review or IA complaint surfaces,
// the question "who had what gear, when, and what condition was
// it returned in?" lands in the equipment custody log. The
// in-app Equipment tab showed all of this but had no print path
// before this util. Same Arial + RMPG-gold + signature-block
// idiom as the prior court PDFs (evidenceItem, shiftReport,
// bodycamVideoCustody, fiCard).
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { drawNavyBanner } from './pdfStandaloneHeader';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import type { OfficerEquipment } from '../types';
import { toDisplayLabel, stripHtmlForPdf } from './formatters';
import { openPdfBlob } from './openPdfDocument';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';

const MT_TZ = 'America/Denver';

export interface CheckoutLogEntry {
  id?: number | string;
  equipment_id?: number | string;
  officer_id?: string | number;
  officer_name?: string;
  action?: 'checkout' | 'checkin' | 'return' | string;
  checkout_date?: string;
  checkin_date?: string;
  created_at?: string;
  performed_by?: string;
  checked_by_name?: string;
  notes?: string;
}

export interface EquipmentPdfInput {
  item: OfficerEquipment;
  /** Optional checkout history fetched from
   *  GET /personnel/equipment/:id/checkout-log. Each row already
   *  joins the actor name so the PDF doesn't need a second lookup.
   *  Empty / undefined renders an "No checkout history recorded" stub. */
  checkoutLog?: CheckoutLogEntry[];
  /** Person who clicked Print — surfaces in the agency strap +
   *  the custodian signature block. */
  preparedBy?: string;
}

function fmtDate(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
    }).format(parseTimestamp(input));
  } catch { return String(input); }
}

function fmtDateTime(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(parseTimestamp(input)) + ' MT';
  } catch { return String(input); }
}

/** Public for testing. The checkout-log timestamp lives on either
 *  `checkout_date` (issuance), `checkin_date` (return), or
 *  `created_at` (audit-only). Pick whichever the row carried. */
export function logEntryDate(entry: CheckoutLogEntry): string {
  return entry.checkout_date || entry.checkin_date || entry.created_at || '';
}

/** Public for testing. Actor preference order matches the route's
 *  SELECT: checked_by_name (JOIN'd) > performed_by (raw id) > —. */
export function logEntryActor(entry: CheckoutLogEntry): string {
  return entry.checked_by_name || entry.performed_by || '—';
}

const ellipsize = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';

export function generateEquipmentCustodyPdf(input: EquipmentPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { item, checkoutLog, preparedBy } = input;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  const refLabel = item.asset_tag
    || item.serial_number
    || `EQ-${item.id ?? '?'}`;

  // Banner
  y = drawNavyBanner(doc, {
    title: `EQUIPMENT CUSTODY — ${refLabel}`,
    subtitle: 'Personnel / Equipment Room',
    rightLine1: fmtDateTime(new Date().toISOString()),
    rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
  });

  // Loss / damage alert banner — equivalent to the disposition-overdue
  // banner on evidence: if the item is currently lost or damaged the
  // PDF leads with that fact, no need to bury it in the status row.
  const isAlert = item.status === 'lost' || item.status === 'damaged'
    || item.condition === 'lost' || item.condition === 'damaged';
  if (isAlert) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text(
      `${(item.status || item.condition || 'flagged').toUpperCase()} — operator-issued equipment requires supervisor review`,
      M + 10, y + 15,
    );
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Item block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('ITEM', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const fields: Array<[string, string]> = [
    ['Type', toDisplayLabel(item.equipment_type)],
    ['Status', (item.status || '—').toUpperCase()],
    ['Make / Model', [item.make, item.model].filter(Boolean).join(' / ') || '—'],
    ['Condition', (item.condition || '—').toUpperCase()],
    ['Serial #', item.serial_number || '—'],
    ['Asset Tag', item.asset_tag || '—'],
    ['Issued To', item.officer_name || '—'],
    ['Officer ID', item.officer_id || '—'],
    ['Issued Date', fmtDate(item.issued_date)],
    ['Returned Date', fmtDate(item.returned_date)],
  ];
  const colW = (W - 2 * M) / 2;
  for (let i = 0; i < fields.length; i += 2) {
    const [lbl1, val1] = fields[i];
    const [lbl2, val2] = fields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val1, 60), M, y + 11);
    if (val2) doc.text(ellipsize(val2, 60), M + colW, y + 11);
    y += 24;
  }

  // ── Notes block (if recorded) ──
  if (item.notes && item.notes.trim()) {
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('NOTES', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    // Strip rich-text-ish HTML the RichTextArea may have written —
    // the on-screen render strips <p> tags but a PDF doesn't have
    // a DOM to inherit that behavior.
    const plain = stripHtmlForPdf(item.notes);
    const lines = doc.splitTextToSize(plain, W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 11 + 6;
  }

  // ── Checkout / Chain-of-custody log ──
  const newPageIfNeeded = (need: number) => {
    if (y + need > H - 80) { doc.addPage(); y = 48; }
  };
  newPageIfNeeded(50);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('CHECKOUT / RETURN LOG', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  const log = Array.isArray(checkoutLog) ? checkoutLog : [];
  const cols = [
    { key: 'date',   label: 'DATE / TIME', width: 110 },
    { key: 'action', label: 'ACTION',      width: 80 },
    { key: 'actor',  label: 'BY',          width: 120 },
    { key: 'notes',  label: 'NOTES',       width: 210 },
  ] as const;

  // Header
  doc.setFillColor('#e6e6e6');
  doc.rect(M, y, W - 2 * M, 14, 'F');
  doc.setFontSize(7.5);
  doc.setFont('Arial', 'bold');
  doc.setTextColor(TEXT_MUTED);
  {
    let x = M + 4;
    for (const c of cols) { doc.text(c.label, x, y + 9); x += c.width; }
  }
  y += 14;
  doc.setFont('Arial', 'normal');

  if (log.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.setFont('Arial', 'italic');
    doc.text('No checkout history recorded.', M + 8, y + 14);
    doc.setFont('Arial', 'normal');
    y += 24;
  } else {
    doc.setFontSize(8);
    log.forEach((entry, i) => {
      newPageIfNeeded(13);
      if (i % 2 === 1) {
        doc.setFillColor(ROW_ALT);
        doc.rect(M, y, W - 2 * M, 13, 'F');
      }
      doc.setTextColor(TEXT_DARK);
      let x = M + 4;
      doc.text(fmtDateTime(logEntryDate(entry)), x, y + 9);
      x += cols[0].width;
      doc.text(toDisplayLabel(entry.action), x, y + 9);
      x += cols[1].width;
      doc.text(ellipsize(logEntryActor(entry), 22), x, y + 9);
      x += cols[2].width;
      doc.text(ellipsize(entry.notes || '—', 40), x, y + 9);
      doc.setDrawColor(BORDER);
      doc.setLineWidth(0.25);
      doc.line(M, y + 13, W - M, y + 13);
      y += 13;
    });
  }

  // ── Signature block ──
  newPageIfNeeded(80);
  y += 14;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;
  doc.line(M, y + 28, M + sigW, y + 28);
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Issuing supervisor signature / date', M, y + 38);
  if (preparedBy) doc.text(preparedBy, M, y + 49);
  doc.text('Receiving officer signature / date', M + sigW + 24, y + 38);
  if (item.officer_name) doc.text(item.officer_name, M + sigW + 24, y + 49);

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Personnel — Equipment Room  ·  ${refLabel}`,
    M, H - 18,
  );

  return doc;
}

export function openEquipmentCustodyPdf(input: EquipmentPdfInput): void {
  const doc = generateEquipmentCustodyPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Equipment Custody');
}
