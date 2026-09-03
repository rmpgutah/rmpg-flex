// ═══════════════════════════════════════════════════════════════
// Audit Log — court-ready PDF generator.
// ───────────────────────────────────────────────────────────────
// The audit log is the highest-evidentiary surface in the app:
// it proves chain-of-custody, who touched what, and when. Defense
// counsel will subpoena it during discovery, and the CSV export
// the page shipped with was not signable evidence. This util
// produces a paginated tabular PDF with a gold banner, a tamper-
// evidence statement, an explicit filter-context block (so the
// reader knows exactly which slice of the log they are holding),
// the rows themselves, and a signature block for the exporting
// supervisor + reviewing supervisor / clerk.
//
// Same Arial + RMPG-gold visual contract as bodycamVideoCustodyPdf
// / conversationTranscriptPdf / fiCardPdf / evidenceItemPdf, so
// court packages built from multiple surfaces have a consistent
// "RMPG record" look.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { openPdfBlob } from './openPdfDocument';
import { drawNavyBanner } from './pdfStandaloneHeader';

const RMPG_GOLD = '#d4a017';
const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const TAMPER_BG = '#fef9e8';
const TAMPER_BORDER = '#b45309';

const MT_TZ = 'America/Denver';

export interface AuditLogEntryForPdf {
  id: number;
  user_id?: number | null;
  user_name?: string | null;
  badge_number?: string | null;
  user_role?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details?: string | null;
  ip_address?: string | null;
  created_at: string;
}

export interface AuditLogPdfFilters {
  action?: string;
  entityType?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export interface AuditLogPdfInput {
  entries: AuditLogEntryForPdf[];
  /** The filter snapshot the operator was looking at when they hit Print.
   *  Rendered verbatim so the resulting PDF cannot be mistaken for a
   *  full-database export. */
  filters?: AuditLogPdfFilters;
  /** Total entry count matching the filters server-side. Distinct from
   *  entries.length when the page paginated the view. */
  totalMatching?: number;
  /** Optional — the user who exported (for the signature block). */
  exportedBy?: string;
}

// ── Public helpers (unit-tested) ─────────────────────────────────

/** Format an ISO/SQLite timestamp as "2026-06-22 14:23:05 MT". */
export function fmtTimestamp(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    const d = parseTimestamp(input);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: MT_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} MT`;
  } catch { return String(input); }
}

/** Word-wrap a long string into lines that fit `maxChars` per line.
 *  Preserves explicit `\n` paragraph breaks. */
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

/** Compose a human-readable summary of the active filters. Returns
 *  "Unfiltered (full audit log)" when every field is empty. Used in
 *  the PDF body AND in the filename so a stack of court packages
 *  doesn't end up with five identical names. */
export function describeFilters(f?: AuditLogPdfFilters): string {
  if (!f) return 'Unfiltered (full audit log)';
  const bits: string[] = [];
  if (f.action) bits.push(`action=${f.action}`);
  if (f.entityType) bits.push(`type=${f.entityType}`);
  if (f.userId) bits.push(`user=${f.userId}`);
  if (f.startDate) bits.push(`from=${f.startDate}`);
  if (f.endDate) bits.push(`to=${f.endDate}`);
  if (f.search) bits.push(`search="${f.search}"`);
  return bits.length === 0 ? 'Unfiltered (full audit log)' : bits.join(', ');
}

// ── PDF body ────────────────────────────────────────────────────

export function generateAuditLogPdf(input: AuditLogPdfInput): jsPDF {
  const { entries, filters, totalMatching, exportedBy } = input;
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  y = drawNavyBanner(doc, {
    title: 'AUDIT LOG — CHAIN OF CUSTODY REPORT',
    subtitle: 'Records Management System',
    rightLine1: `Generated ${fmtTimestamp(new Date().toISOString())}`,
  });

  // Tamper-evidence statement — describes the operational reality so the
  // reader knows what guarantees this document provides. The audit_log
  // table is append-only at the application layer (no UPDATE / DELETE
  // routes exposed; the retention-purge endpoint is admin-only and
  // produces its own audit_log row identifying the purger). This block
  // is what makes the PDF defensible in court.
  doc.setFillColor(TAMPER_BG);
  doc.setDrawColor(TAMPER_BORDER);
  doc.setLineWidth(0.75);
  doc.rect(M, y, W - 2 * M, 38, 'FD');
  doc.setFont('Arial', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(TAMPER_BORDER);
  doc.text('TAMPER-EVIDENCE STATEMENT', M + 8, y + 12);
  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_DARK);
  const tamperLines = [
    'Entries are written append-only by RMPG Flex; the application exposes no UPDATE or DELETE',
    'API for audit_log rows. Retention purges require admin role and themselves generate audit',
    'entries. This document reflects the system state at the generation time shown above.',
  ];
  for (let i = 0; i < tamperLines.length; i++) {
    doc.text(tamperLines[i], M + 8, y + 22 + i * 8);
  }
  y += 48;
  doc.setLineWidth(0.5);

  // ── Filter context block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('REPORT SCOPE', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;

  const summaryFields: Array<[string, string]> = [
    ['Filter', describeFilters(filters)],
    ['Rows in this PDF', String(entries.length)],
    ['Total matching', totalMatching != null ? String(totalMatching) : String(entries.length)],
    ['Report period', filters?.startDate || filters?.endDate
      ? `${filters?.startDate || 'beginning'} → ${filters?.endDate || 'now'}`
      : 'All time (capped by row limit)'],
  ];
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  for (const [lbl, val] of summaryFields) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), M, y);
    doc.setTextColor(TEXT_DARK);
    const wrapped = wrapText(val, 120);
    doc.text(wrapped[0] || '—', M + 110, y);
    y += 13;
    for (let i = 1; i < wrapped.length; i++) {
      if (y > H - 100) { doc.addPage(); y = 48; }
      doc.text(wrapped[i], M + 110, y);
      y += 11;
    }
  }
  y += 6;

  // ── Entries table ──
  // Landscape letter: 792 × 612. Usable width ≈ 720. Column budget
  // (in points): Timestamp 110, User 95, Action 95, Entity 90, Details 250, IP 80.
  const COL_TS = M;
  const COL_USER = COL_TS + 110;
  const COL_ACTION = COL_USER + 95;
  const COL_ENTITY = COL_ACTION + 95;
  const COL_DETAILS = COL_ENTITY + 90;
  const COL_IP = COL_DETAILS + 250;

  const drawHeader = (startY: number) => {
    doc.setFillColor(RMPG_GOLD);
    doc.rect(M, startY, W - 2 * M, 16, 'F');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    doc.text('TIMESTAMP', COL_TS + 2, startY + 11);
    doc.text('USER', COL_USER + 2, startY + 11);
    doc.text('ACTION', COL_ACTION + 2, startY + 11);
    doc.text('ENTITY', COL_ENTITY + 2, startY + 11);
    doc.text('DETAILS', COL_DETAILS + 2, startY + 11);
    doc.text('IP', COL_IP + 2, startY + 11);
    return startY + 16;
  };

  if (y > H - 120) { doc.addPage(); y = 48; }
  y = drawHeader(y);

  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const detailsLines = wrapText(e.details || '—', 60);
    const rowHeight = Math.max(12, detailsLines.length * 9 + 4);

    if (y + rowHeight > H - 80) {
      doc.addPage();
      y = 48;
      y = drawHeader(y);
      doc.setFont('Arial', 'normal');
      doc.setFontSize(8);
    }

    // Zebra stripe — improves legibility on long printouts.
    if (i % 2 === 1) {
      doc.setFillColor(ROW_ALT);
      doc.rect(M, y, W - 2 * M, rowHeight, 'F');
    }
    doc.setTextColor(TEXT_DARK);
    doc.text(fmtTimestamp(e.created_at), COL_TS + 2, y + 10);

    const userLabel = e.user_name
      ? (e.badge_number ? `${e.user_name} (#${e.badge_number})` : e.user_name)
      : 'System';
    doc.text(userLabel, COL_USER + 2, y + 10);

    doc.text(e.action || '—', COL_ACTION + 2, y + 10);

    const entityLabel = e.entity_type
      ? (e.entity_id ? `${e.entity_type} #${e.entity_id}` : e.entity_type)
      : '—';
    doc.text(entityLabel, COL_ENTITY + 2, y + 10);

    for (let li = 0; li < detailsLines.length; li++) {
      doc.text(detailsLines[li], COL_DETAILS + 2, y + 10 + li * 9);
    }

    doc.text(e.ip_address || '—', COL_IP + 2, y + 10);

    y += rowHeight;
  }

  if (entries.length === 0) {
    doc.setTextColor(TEXT_MUTED);
    doc.setFontSize(9);
    doc.text('No audit entries match the active filters.', M + 4, y + 14);
    y += 24;
  }

  // ── Signature block ──
  if (y > H - 100) { doc.addPage(); y = 48; }
  y += 16;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;
  doc.line(M, y + 28, M + sigW, y + 28);
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Exporting supervisor signature / date', M, y + 38);
  if (exportedBy) doc.text(exportedBy, M, y + 49);
  doc.text('Reviewing supervisor / clerk signature / date', M + sigW + 24, y + 38);

  // Footer (every page)
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(TEXT_MUTED);
    doc.text(
      `Generated ${fmtTimestamp(new Date().toISOString())}  ·  RMPG Flex Audit Log  ·  Page ${p} of ${pageCount}`,
      M, H - 18,
    );
  }

  return doc;
}

/** Open the generated PDF in a new browser tab. Used by the page button.
 *  Kept as a thin wrapper so the generator stays testable without jsdom
 *  tripping over window.open. */
export function openAuditLogPdf(input: AuditLogPdfInput): void {
  const doc = generateAuditLogPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Audit Log');
}
