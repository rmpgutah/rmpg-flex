// ═══════════════════════════════════════════════════════════════
// Trespass Order — court-ready PDF generator.
// A trespass order is itself a court document — the served notice
// IS the operator artifact (it's what gets handed to the subject
// AND what gets attached to the case file when the order is
// violated and arrest follows). Before this util the only print
// option was bulk CSV — operators preparing court packages or
// supervisor reviews had to screenshot the detail panel.
//
// Same Arial + RMPG-gold banner pattern as shiftReportPdf,
// clearedSummaryPdf, fiCardPdf.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import type { TrespassOrder, TrespassOrderType, TrespassOrderStatus } from '../types';
import { parseTimestamp } from './dateUtils';
import { toDisplayLabel } from './formatters';
import { openPdfBlob } from './openPdfDocument';
import { drawNavyBanner } from './pdfStandaloneHeader';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';
const STATUS_GREEN = '#15803d';

const MT_TZ = 'America/Denver';

const ORDER_TYPE_LABELS: Record<TrespassOrderType, string> = {
  trespass_warning: 'Trespass Warning',
  exclusion_order: 'Exclusion Order',
  ban: 'Ban',
  no_contact: 'No Contact Order',
};

const STATUS_LABELS: Record<TrespassOrderStatus, string> = {
  active: 'Active',
  served: 'Served',
  expired: 'Expired',
  lifted: 'Lifted',
  violated: 'Violated',
};

function fmtDate(input: string | undefined | null): string {
  if (!input) return '—';
  // Bare YYYY-MM-DD calendar dates (DOB, expiration_date, effective_date) have
  // no time component — render them from the string parts in UTC so they don't
  // drift one day back when the runtime zone is UTC (CI) vs Mountain (dev).
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
    }).format(Date.UTC(+y, +m - 1, +d));
  }
  try {
    const d = parseTimestamp(input);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
    }).format(d);
  } catch { return String(input); }
}

function fmtDateTime(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    const d = parseTimestamp(input);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d) + ' MT';
  } catch { return String(input); }
}

/** Public for testing. Word-wraps a long string into lines that fit
 *  `maxChars` per line. Preserves explicit `\n` breaks. Used for the
 *  reason / conditions / notes blocks. */
export function wrapText(input: string, maxChars: number): string[] {
  if (!input) return [''];
  const out: string[] = [];
  for (const paragraph of input.split(/\r?\n/)) {
    if (!paragraph) { out.push(''); continue; }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const w of words) {
      if (!line) { line = w; continue; }
      if ((line + ' ' + w).length > maxChars) { out.push(line); line = w; }
      else line = line + ' ' + w;
    }
    if (line) out.push(line);
  }
  return out;
}

/** Public for testing. Computes the human-readable expiration line:
 *  "Permanent" when no expiration_date, "Expires …" with a relative
 *  callout for active orders within 30 days. */
export function expirationLine(order: Pick<TrespassOrder, 'expiration_date' | 'status'>): string {
  if (!order.expiration_date) return 'Permanent';
  const base = `Expires ${fmtDate(order.expiration_date)}`;
  if (order.status !== 'active') return base;
  try {
    const exp = parseTimestamp(order.expiration_date).getTime();
    const days = Math.round((exp - Date.now()) / (1000 * 60 * 60 * 24));
    if (Number.isFinite(days)) {
      if (days < 0) return `${base} (EXPIRED ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago)`;
      if (days === 0) return `${base} (expires today)`;
      if (days <= 30) return `${base} (${days} day${days === 1 ? '' : 's'} remaining)`;
    }
    return base;
  } catch { return base; }
}

/** Public for testing. The banner color decision — red for active /
 *  violated (high-attention), amber for served (mid), gray for closed
 *  states (expired/lifted). Keeps the PDF visually consistent with the
 *  detail panel STATUS_COLORS map. */
export function bannerStyleFor(status: TrespassOrderStatus): {
  bg: string; fg: string; label: string;
} {
  switch (status) {
    case 'active':
      return { bg: ALERT_BG, fg: ALERT_BORDER, label: 'ACTIVE ORDER — IN FORCE' };
    case 'violated':
      return { bg: ALERT_BG, fg: ALERT_BORDER, label: 'VIOLATED — ENFORCEMENT ACTION REQUIRED' };
    case 'served':
      return { bg: '#fff7ed', fg: '#b45309', label: 'SERVED — IN EFFECT' };
    case 'lifted':
      return { bg: '#f1f5f9', fg: STATUS_GREEN, label: 'LIFTED — NO LONGER IN EFFECT' };
    case 'expired':
      return { bg: '#f5f5f5', fg: TEXT_MUTED, label: 'EXPIRED — NO LONGER IN EFFECT' };
    default:
      return { bg: '#f5f5f5', fg: TEXT_MUTED, label: STATUS_LABELS[status] || String(status).toUpperCase() };
  }
}

export function generateTrespassOrderPdf(order: TrespassOrder): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  // ── Navy banner ──
  y = drawNavyBanner(doc, {
    title: `TRESPASS ORDER — ${order.order_number}`,
    subtitle: 'Records Division',
    rightLine1: `Issued ${fmtDateTime(order.created_at)}`,
    rightLine2: `Issuing officer: ${order.issued_by_name || order.issued_by_display || '—'}`,
  });

  // ── Status banner ──
  const banner = bannerStyleFor(order.status);
  doc.setFillColor(banner.bg);
  doc.setDrawColor(banner.fg);
  doc.setLineWidth(0.75);
  doc.rect(M, y, W - 2 * M, 22, 'FD');
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(banner.fg);
  doc.text(banner.label, M + 10, y + 15);
  doc.setFontSize(9);
  doc.setFont('Arial', 'normal');
  doc.text(expirationLine(order), W - M - 10, y + 15, { align: 'right' });
  y += 30;
  doc.setLineWidth(0.5);

  // ── Subject block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('SUBJECT', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;

  const subjectFields: Array<[string, string]> = [
    ['Name', `${order.subject_last_name || ''}, ${order.subject_first_name || ''}`.replace(/^,\s*$/, '—')],
    ['DOB', fmtDate(order.subject_dob || '')],
    ['Description', order.subject_description || '—'],
  ];
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  for (const [lbl, val] of subjectFields) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), M, y);
    doc.setTextColor(TEXT_DARK);
    // Description can be long — wrap if necessary
    if (lbl === 'Description' && val.length > 70) {
      const lines = wrapText(val, 70);
      for (let i = 0; i < lines.length; i++) {
        doc.text(lines[i], M + 110, y + i * 11);
      }
      y += 14 + (lines.length - 1) * 11;
    } else {
      doc.text(val, M + 110, y);
      y += 14;
    }
  }
  y += 4;

  // ── Order block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.text('ORDER', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  const orderFields: Array<[string, string]> = [
    ['Order Type', ORDER_TYPE_LABELS[order.order_type] || toDisplayLabel(String(order.order_type))],
    ['Status', STATUS_LABELS[order.status] || String(order.status)],
    ['Property', order.property_name || '—'],
    ['Location', order.location || '—'],
    ['Effective', fmtDate(order.effective_date || order.created_at)],
    ['Expires', order.expiration_date ? fmtDate(order.expiration_date) : 'Permanent'],
    ['Duration', order.duration_days ? `${order.duration_days} day${order.duration_days === 1 ? '' : 's'}` : 'Permanent'],
    ['Authorized By', order.authorized_by || '—'],
  ];
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  for (const [lbl, val] of orderFields) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), M, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(val, M + 110, y);
    y += 14;
  }
  y += 4;

  // ── Reason block ──
  if (order.reason) {
    if (y > H - 140) { doc.addPage(); y = 48; }
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('REASON', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;

    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    for (const line of wrapText(order.reason, 95)) {
      if (y > H - 100) { doc.addPage(); y = 48; }
      doc.text(line, M, y);
      y += 12;
    }
    y += 6;
  }

  // ── Conditions / exceptions ──
  if (order.conditions) {
    if (y > H - 140) { doc.addPage(); y = 48; }
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('CONDITIONS / EXCEPTIONS', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;

    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    for (const line of wrapText(order.conditions, 95)) {
      if (y > H - 100) { doc.addPage(); y = 48; }
      doc.text(line, M, y);
      y += 12;
    }
    y += 6;
  }

  // ── Service block (when served) ──
  if (order.served_at) {
    if (y > H - 120) { doc.addPage(); y = 48; }
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.text('SERVICE', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;

    const serviceFields: Array<[string, string]> = [
      ['Served On', fmtDateTime(order.served_at)],
      ['Served By', order.served_by_name || '—'],
    ];
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    for (const [lbl, val] of serviceFields) {
      doc.setTextColor(TEXT_MUTED);
      doc.text(lbl.toUpperCase(), M, y);
      doc.setTextColor(TEXT_DARK);
      doc.text(val, M + 110, y);
      y += 14;
    }
    y += 4;
  }

  // ── Notes block ──
  if (order.notes) {
    if (y > H - 120) { doc.addPage(); y = 48; }
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('NOTES', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;

    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    for (const line of wrapText(order.notes, 95)) {
      if (y > H - 100) { doc.addPage(); y = 48; }
      doc.text(line, M, y);
      y += 12;
    }
    y += 6;
  }

  // ── Signature block ──
  if (y > H - 120) { doc.addPage(); y = 48; }
  y += 10;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;

  // Left: issuing officer line
  doc.line(M, y + 28, M + sigW, y + 28);
  // Right: subject acknowledgement line (only for active/served orders)
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);

  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Issuing officer signature', M, y + 38);
  doc.text(
    (order.issued_by_name || order.issued_by_display || '').trim() || '—',
    M, y + 49,
  );
  // The right column changes by status: subject ack only makes sense
  // when the order is being served, supervisor-review otherwise.
  if (order.status === 'active' || order.status === 'served') {
    doc.text('Subject signature (acknowledgement of service) / date', M + sigW + 24, y + 38);
  } else {
    doc.text('Supervisor signature / date', M + sigW + 24, y + 38);
  }

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Records Division  ·  Order ${order.order_number}`,
    M, H - 18,
  );

  return doc;
}

export function openTrespassOrderPdf(order: TrespassOrder): void {
  const doc = generateTrespassOrderPdf(order);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Trespass Order');
}
