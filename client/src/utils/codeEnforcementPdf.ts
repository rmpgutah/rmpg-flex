// ═══════════════════════════════════════════════════════════════
// RMPG Flex — Code Enforcement Notice & Tow Order PDF generator
//
// Code-enforcement notices (NOTICE OF VIOLATION / Abatement) and
// tow orders ARE the operator artifact — the document handed to a
// property owner or driver. Before this util the only print path
// was the bulk CSV export; an officer wanting a single notice had
// to screenshot the detail panel and crop it.
//
// Same Arial + RMPG-gold banner pattern as fiCardPdf,
// criminalHistoryPdf, and evidenceItemPdf so the operator's court
// package has a single, recognizable look.
//
// Two entry points:
//   - openCodeViolationNoticePdf(v)  → "NOTICE OF VIOLATION"
//   - openTowOrderPdf(t)             → "VEHICLE TOW ORDER"
//
// All format helpers are exported as pure functions so the unit
// tests can exercise them without a jsPDF instance.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { drawNavyBanner } from './pdfStandaloneHeader';
import { registerArialFont } from './pdf/fonts/registerArial';
import type { CodeViolation, VehicleTow } from '../types';
import { parseTimestamp } from './dateUtils';
import { toDisplayLabel } from './formatters';
import { openPdfBlob } from './openPdfDocument';

const RMPG_GOLD = '#d4a017';
const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';
const WARN_BG = '#fff7e0';
const WARN_BORDER = '#a16207';

const MT_TZ = 'America/Denver';

export function fmtDate(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    const d = parseTimestamp(input);
    if (Number.isNaN(d.getTime())) return String(input);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
    }).format(d);
  } catch { return String(input); }
}

export function fmtDateTime(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    const d = parseTimestamp(input);
    if (Number.isNaN(d.getTime())) return String(input);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d) + ' MT';
  } catch { return String(input); }
}

export function fmtMoney(n: number | string | undefined | null): string {
  if (n === undefined || n === null || n === '') return '—';
  const num = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(num)) return '—';
  return `$${num.toFixed(2)}`;
}

/** Public for testing. Word-wraps a long string into lines that fit `maxChars`
 *  per line. Preserves explicit `\n` breaks. Used for description / notes. */
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

/** Public for testing. Severity → human label + alert flag.
 *  Critical / high / major all surface a red "CRITICAL VIOLATION" banner. */
export function classifySeverity(sev: string | undefined | null): {
  label: string; isCritical: boolean;
} {
  const s = String(sev ?? '').toLowerCase().trim();
  const isCritical = s === 'critical' || s === 'high' || s === 'major';
  const label = s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
  return { label, isCritical };
}

function violationTypeLabel(t: string | undefined | null): string {
  const v = toDisplayLabel(String(t ?? ''));
  if (!v) return '—';
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function statusLabel(s: string | undefined | null): string {
  return toDisplayLabel(String(s ?? '')).toUpperCase() || '—';
}

export function generateCodeViolationNoticePdf(v: CodeViolation): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  // ── Banner ──
  y = drawNavyBanner(doc, {
    title: `NOTICE OF VIOLATION — ${v.violation_number || '—'}`,
    subtitle: 'Code Enforcement',
    rightLine1: `Issued ${fmtDateTime(v.created_at)}`,
    rightLine2: v.reporting_officer_name ? `Officer: ${v.reporting_officer_name}` : undefined,
  });

  // ── Critical severity banner ──
  const sev = classifySeverity(v.severity);
  if (sev.isCritical) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text('CRITICAL VIOLATION — IMMEDIATE COMPLIANCE REQUIRED', M + 10, y + 15);
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Deadline reminder banner ──
  if (v.compliance_deadline) {
    doc.setFillColor(WARN_BG);
    doc.setDrawColor(WARN_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(WARN_BORDER);
    doc.text(
      `COMPLIANCE DEADLINE: ${fmtDate(v.compliance_deadline)}`,
      M + 10, y + 15,
    );
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Violation block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('VIOLATION', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;

  const violationFields: Array<[string, string]> = [
    ['Type', violationTypeLabel(v.violation_type)],
    ['Status', statusLabel(v.status)],
    ['Code Section', v.code_section || '—'],
    ['Severity', sev.label],
    ['Fine Amount', fmtMoney(v.fine_amount)],
    ['Compliance Deadline', fmtDate(v.compliance_deadline)],
  ];
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  const colW = (W - 2 * M) / 2;
  for (let i = 0; i < violationFields.length; i += 2) {
    const [lbl1, val1] = violationFields[i];
    const [lbl2, val2] = violationFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(val1, M, y + 11);
    if (val2) doc.text(val2, M + colW, y + 11);
    y += 24;
  }

  // ── Location & violator ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.text('PROPERTY', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  doc.text('LOCATION', M, y);
  doc.setTextColor(TEXT_DARK);
  const locLines = wrapText(v.location || '—', 80);
  doc.text(locLines[0] || '—', M + 90, y);
  y += 12;
  for (let i = 1; i < locLines.length; i++) {
    doc.text(locLines[i], M + 90, y);
    y += 12;
  }

  if (v.violator_name || v.violator_contact) {
    doc.setTextColor(TEXT_MUTED);
    doc.text('VIOLATOR', M, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(
      [v.violator_name, v.violator_contact].filter(Boolean).join(' — ') || '—',
      M + 90, y,
    );
    y += 14;
  }
  y += 6;

  // ── Description ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('DESCRIPTION', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  const descLines = wrapText(v.description || '—', 95);
  for (const line of descLines) {
    if (y > H - 100) { doc.addPage(); y = 48; }
    doc.text(line, M, y);
    y += 12;
  }
  y += 6;

  // ── Resolution (if any) ──
  if (v.resolution_notes || v.resolved_date) {
    if (y > H - 80) { doc.addPage(); y = 48; }
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('RESOLUTION', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    if (v.resolved_date) {
      doc.setTextColor(TEXT_MUTED);
      doc.text('RESOLVED', M, y);
      doc.setTextColor(TEXT_DARK);
      doc.text(fmtDate(v.resolved_date), M + 90, y);
      y += 14;
    }
    if (v.resolution_notes) {
      const notesLines = wrapText(v.resolution_notes, 95);
      for (const line of notesLines) {
        if (y > H - 100) { doc.addPage(); y = 48; }
        doc.text(line, M, y);
        y += 12;
      }
    }
    y += 6;
  }

  // ── Signature block ──
  if (y > H - 100) { doc.addPage(); y = 48; }
  y += 10;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;
  doc.line(M, y + 28, M + sigW, y + 28);
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Issuing officer signature', M, y + 38);
  doc.text(
    `${v.reporting_officer_name || ''}`.trim() || '—',
    M, y + 49,
  );
  doc.text('Recipient signature / date', M + sigW + 24, y + 38);

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Code Enforcement  ·  Violation #${v.violation_number || v.id}`,
    M, H - 18,
  );

  return doc;
}

export function openCodeViolationNoticePdf(v: CodeViolation): void {
  const doc = generateCodeViolationNoticePdf(v);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Code Violation Notice');
}

export function generateTowOrderPdf(t: VehicleTow): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  // ── Banner ──
  doc.setFillColor(RMPG_GOLD);
  doc.rect(M, y, W - 2 * M, 28, 'F');
  doc.setFont('Arial', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(TEXT_DARK);
  doc.text(`VEHICLE TOW ORDER — ${t.tow_number || '—'}`, M + 10, y + 19);
  doc.setFontSize(9);
  doc.setFont('Arial', 'normal');
  doc.text(
    `Ordered ${fmtDateTime((t as any).ordered_at || (t as any).created_at)}`,
    W - M - 10, y + 19, { align: 'right' },
  );
  y += 38;

  // ── Agency strap ──
  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Rocky Mountain Protective Group  ·  Vehicle Impound', M, y);
  doc.text(
    `Officer: ${(t as any).requesting_officer_name || (t as any).officer_name || '—'}`,
    W - M, y, { align: 'right' },
  );
  y += 14;

  // ── Status pill ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_DARK);
  doc.text(`STATUS: ${statusLabel(t.status)}`, M, y);
  doc.text(
    `REASON: ${toDisplayLabel(String(t.tow_reason || '')).toUpperCase() || '—'}`,
    M + 200, y,
  );
  y += 16;

  // ── Vehicle block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('VEHICLE', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;

  const vehicleStr = [t.vehicle_year, t.vehicle_color, t.vehicle_make, t.vehicle_model]
    .filter(Boolean).join(' ') || '—';

  const vehicleFields: Array<[string, string]> = [
    ['Year / Make / Model', vehicleStr],
    ['Color', t.vehicle_color || '—'],
    ['License Plate', t.vehicle_plate || '—'],
    ['Plate State', t.vehicle_state || '—'],
    ['VIN', t.vehicle_vin || '—'],
    ['Authorization', (t as any).authorization || '—'],
  ];
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  const colW = (W - 2 * M) / 2;
  for (let i = 0; i < vehicleFields.length; i += 2) {
    const [lbl1, val1] = vehicleFields[i];
    const [lbl2, val2] = vehicleFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(val1, M, y + 11);
    if (val2) doc.text(val2, M + colW, y + 11);
    y += 24;
  }

  // ── Tow block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('TOW', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  doc.text('FROM', M, y);
  doc.setTextColor(TEXT_DARK);
  const fromLines = wrapText(t.tow_from || '—', 80);
  doc.text(fromLines[0] || '—', M + 90, y);
  y += 12;
  for (let i = 1; i < fromLines.length; i++) {
    doc.text(fromLines[i], M + 90, y);
    y += 12;
  }

  doc.setTextColor(TEXT_MUTED);
  doc.text('TO', M, y);
  doc.setTextColor(TEXT_DARK);
  doc.text(t.tow_to || '—', M + 90, y);
  y += 14;

  doc.setTextColor(TEXT_MUTED);
  doc.text('TOW COMPANY', M, y);
  doc.setTextColor(TEXT_DARK);
  const company = [t.tow_company, t.tow_driver, t.tow_company_phone]
    .filter(Boolean).join(' — ') || '—';
  doc.text(company, M + 90, y);
  y += 14;

  // ── Fees ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('FEES', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  const feeFields: Array<[string, string]> = [
    ['Tow Fee', fmtMoney((t as any).tow_fee)],
    ['Storage Fee / Day', fmtMoney((t as any).storage_fee_daily ?? (t as any).storage_fee)],
  ];
  for (const [lbl, val] of feeFields) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), M, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(val, M + 110, y);
    y += 14;
  }
  y += 6;

  // ── Notes ──
  if ((t as any).notes) {
    if (y > H - 80) { doc.addPage(); y = 48; }
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('NOTES', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    const notesLines = wrapText(String((t as any).notes), 95);
    for (const line of notesLines) {
      if (y > H - 100) { doc.addPage(); y = 48; }
      doc.text(line, M, y);
      y += 12;
    }
    y += 6;
  }

  // ── Signature block ──
  if (y > H - 100) { doc.addPage(); y = 48; }
  y += 10;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;
  doc.line(M, y + 28, M + sigW, y + 28);
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Ordering officer signature', M, y + 38);
  doc.text(
    `${(t as any).requesting_officer_name || (t as any).officer_name || ''}`.trim() || '—',
    M, y + 49,
  );
  doc.text('Tow driver signature / date', M + sigW + 24, y + 38);

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Vehicle Impound  ·  Tow #${t.tow_number || t.id}`,
    M, H - 18,
  );

  return doc;
}

export function openTowOrderPdf(t: VehicleTow): void {
  const doc = generateTowOrderPdf(t);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Tow Order');
}
