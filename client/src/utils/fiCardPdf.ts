// ═══════════════════════════════════════════════════════════════
// Field Interview Card — court-ready PDF generator.
// Field Interviews are court-admissible records of officer contacts
// (narrative, reason, location, subject details, warrant flags).
// Before this util the only print option was bulk CSV — operators
// preparing court packages or supervisor reviews had to screenshot
// the detail panel. Same Arial + RMPG-gold banner pattern as
// shiftReportPdf + clearedSummaryPdf.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import type { FieldInterview } from '../types';
import { parseTimestamp } from './dateUtils';
import { formatEnumValue, toDisplayLabel } from './formatters';
import { openPdfBlob } from './openPdfDocument';
import { drawNavyBanner } from './pdfStandaloneHeader';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';

const MT_TZ = 'America/Denver';

function fmtDate(input: string | undefined | null): string {
  if (!input) return '—';
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

/** Public for testing. Returns true when the parsed person_flags JSON contains
 *  an ACTIVE_WARRANT entry (string OR { type: 'ACTIVE_WARRANT' }). Matches the
 *  warning-banner logic in FieldInterviewsPage so the PDF + the UI agree. */
export function hasActiveWarrant(personFlags: unknown): boolean {
  try {
    const flags = typeof personFlags === 'string'
      ? JSON.parse(personFlags || '[]')
      : (personFlags ?? []);
    if (!Array.isArray(flags)) return false;
    return flags.some((f: any) => f?.type === 'ACTIVE_WARRANT' || f === 'ACTIVE_WARRANT');
  } catch {
    return false;
  }
}

/** Public for testing. Word-wraps a long string into lines that fit `maxChars`
 *  per line. Preserves explicit `\n` breaks. Used for the narrative block. */
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

export function generateFiCardPdf(fi: FieldInterview): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  y = drawNavyBanner(doc, {
    title: `FIELD INTERVIEW CARD — ${fi.fi_number || fi.id}`,
    subtitle: 'Field Operations',
    rightLine1: `Created ${fmtDateTime(fi.created_at)}`,
    rightLine2: `Officer: ${fi.officer_name || fi.officer_display_name || '—'}`,
  });

  // Active-warrant banner (red bar, only when subject has one)
  if (hasActiveWarrant(fi.person_flags)) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text('SUBJECT HAS ACTIVE WARRANTS — EXERCISE CAUTION', M + 10, y + 15);
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Subject block (two-column) ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('SUBJECT', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;

  const subjectFields: Array<[string, string]> = [
    ['Name', `${fi.subject_last_name || ''}, ${fi.subject_first_name || ''}`.replace(/^,\s*$/, '—')],
    ['DOB', fmtDate(fi.subject_dob || '')],
    ['Gender / Race', [fi.subject_gender, fi.subject_race].filter(Boolean).join(' / ') || '—'],
    ['Build', [fi.subject_height, fi.subject_weight ? `${fi.subject_weight} lbs` : ''].filter(Boolean).join(', ') || '—'],
    ['Hair / Eyes', [fi.subject_hair, fi.subject_eye].filter(Boolean).join(' / ') || '—'],
    ['Clothing', fi.subject_clothing || '—'],
  ];
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  const colW = (W - 2 * M) / 2;
  for (let i = 0; i < subjectFields.length; i += 2) {
    const [lbl1, val1] = subjectFields[i];
    const [lbl2, val2] = subjectFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(val1, M, y + 11);
    if (val2) doc.text(val2, M + colW, y + 11);
    y += 24;
  }

  // ── Contact block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.text('CONTACT', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  const contactFields: Array<[string, string]> = [
    ['Location', fi.location || '—'],
    ['Contact Reason', toDisplayLabel(fi.contact_reason)],
    ['Contact Type', formatEnumValue(fi.contact_type) || '—'],
    ['Action Taken', fi.action_taken || '—'],
  ];
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  for (const [lbl, val] of contactFields) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), M, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(val, M + 110, y);
    y += 14;
  }

  if (fi.vehicle_plate || fi.vehicle_description) {
    doc.setTextColor(TEXT_MUTED);
    doc.text('VEHICLE', M, y);
    doc.setTextColor(TEXT_DARK);
    const v = [fi.vehicle_plate, fi.vehicle_description].filter(Boolean).join(' — ');
    doc.text(v, M + 110, y);
    y += 14;
  }
  y += 6;

  // ── Narrative ──
  if (fi.narrative) {
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('NARRATIVE', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;

    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    const lines = wrapText(fi.narrative, 95);
    for (const line of lines) {
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
  doc.text('Reporting officer signature', M, y + 38);
  doc.text(
    `${fi.officer_name || fi.officer_display_name || ''}`.trim() || '—',
    M, y + 49,
  );
  doc.text('Supervisor signature / date', M + sigW + 24, y + 38);

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Field Operations  ·  FI #${fi.fi_number}`,
    M, H - 18,
  );

  return doc;
}

export function openFiCardPdf(fi: FieldInterview): void {
  const doc = generateFiCardPdf(fi);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'FI Card');
}
