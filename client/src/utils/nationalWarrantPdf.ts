// ═══════════════════════════════════════════════════════════════
// National Warrant Result — court-ready PDF.
// A National Warrant Search hit is a court record from a remote
// jurisdiction (state/federal). Before this util the only path
// from the result row was a right-click "Copy name / Copy charges"
// context menu — operators preparing an extradition package or
// hand-off file to a deputy had to screenshot the row. Mirrors
// the Arial + RMPG-gold banner template used by fiCardPdf /
// criminalHistoryPdf / evidenceItemPdf.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { toDisplayLabel } from './formatters';
import { openPdfBlob } from './openPdfDocument';
import { drawNavyBanner } from './pdfStandaloneHeader';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';

const MT_TZ = 'America/Denver';

export interface NationalWarrantHit {
  // Identity
  full_name?: string;
  first_name?: string;
  last_name?: string;
  dob?: string;
  age?: number | string;
  city?: string;
  state?: string;

  // Charge / warrant
  charges?: string;
  warrant_type?: string;
  offense_level?: string;
  status?: string;
  case_number?: string;
  court?: string;
  issued_date?: string;
  bond_amount?: number | string;

  // Provenance
  source?: string;
  detail_url?: string;
  photo_url?: string;
  kind?: string;
}

export interface NationalWarrantPdfInput {
  warrant: NationalWarrantHit;
  /** Officer pulling the report (from useAuth on the calling side). */
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

/** Public for testing. Builds the "LAST, First" form when structured parts
 *  exist; otherwise falls back to `full_name`; otherwise "UNKNOWN SUBJECT". */
export function formatWarrantName(w: NationalWarrantHit): string {
  const last = (w.last_name || '').trim();
  const first = (w.first_name || '').trim();
  if (last) {
    return first
      ? `${last.toUpperCase()}, ${first}`
      : last.toUpperCase();
  }
  if (w.full_name) return String(w.full_name).toUpperCase();
  return 'UNKNOWN SUBJECT';
}

/** Public for testing. True only for a clearly-active warrant — defensive
 *  about the upstream `status` field which can be empty / null / mixed-case. */
export function isActiveWarrant(w: NationalWarrantHit): boolean {
  const s = (w.status || '').toString().trim().toLowerCase();
  return s === 'active';
}

/** Public for testing. Word-wraps a long string into lines that fit
 *  `maxChars` per line. Preserves explicit `\n` breaks. Used for charges
 *  + the optional source-link block. */
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

/** Public for testing. Formats the bond as "$1,234" when finite + positive;
 *  otherwise "—". Accepts string or number (upstream is inconsistent). */
export function formatBond(input: number | string | undefined | null): string {
  if (input == null || input === '') return '—';
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `$${n.toLocaleString()}`;
}

export function generateNationalWarrantPdf(input: NationalWarrantPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { warrant, preparedBy } = input;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  y = drawNavyBanner(doc, {
    title: 'NATIONAL WARRANT — RESULT',
    subtitle: 'National Warrant Search',
    rightLine1: fmtDateTime(new Date().toISOString()),
  });

  // Active-warrant alert bar (red) — only when the upstream said active.
  if (isActiveWarrant(warrant)) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text('ACTIVE WARRANT — VERIFY HIT WITH ORIGINATING AGENCY BEFORE ACTION', M + 10, y + 15);
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Subject block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('SUBJECT', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const locParts: string[] = [];
  if (warrant.city) locParts.push(String(warrant.city));
  if (warrant.state) locParts.push(String(warrant.state).toUpperCase());

  const subjectFields: Array<[string, string]> = [
    ['Name', formatWarrantName(warrant)],
    ['DOB', fmtDate(warrant.dob)],
    ['Age', warrant.age != null && warrant.age !== '' ? String(warrant.age) : '—'],
    ['City / State', locParts.join(', ') || '—'],
  ];
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

  // ── Warrant block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.text('WARRANT', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const warrantFields: Array<[string, string]> = [
    ['Warrant Type', toDisplayLabel(warrant.warrant_type)],
    ['Offense Level', toDisplayLabel(warrant.offense_level)],
    ['Status', toDisplayLabel(warrant.status)],
    ['Case Number', warrant.case_number || '—'],
    ['Issuing Court', warrant.court || '—'],
    ['Issued', fmtDate(warrant.issued_date)],
    ['Bond Amount', formatBond(warrant.bond_amount)],
    ['Source', warrant.source || '—'],
  ];
  for (let i = 0; i < warrantFields.length; i += 2) {
    const [lbl1, val1] = warrantFields[i];
    const [lbl2, val2] = warrantFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(val1, M, y + 11);
    if (val2) doc.text(val2, M + colW, y + 11);
    y += 24;
  }

  // ── Charges (multi-line) ──
  if (warrant.charges) {
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.text('CHARGES', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    const lines = wrapText(String(warrant.charges), 95);
    for (const line of lines) {
      if (y > H - 100) { doc.addPage(); y = 48; }
      doc.text(line, M, y);
      y += 12;
    }
    y += 6;
  }

  // ── Source / verification block ──
  if (warrant.detail_url) {
    if (y > H - 80) { doc.addPage(); y = 48; }
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('VERIFICATION', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(TEXT_MUTED);
    doc.text('Origin record (verify hit before action):', M, y);
    y += 11;
    doc.setTextColor(TEXT_DARK);
    const urlLines = wrapText(String(warrant.detail_url), 110);
    for (const line of urlLines) {
      if (y > H - 80) { doc.addPage(); y = 48; }
      doc.text(line, M, y);
      y += 11;
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
  doc.text('Pulling officer signature', M, y + 38);
  if (preparedBy) doc.text(preparedBy, M, y + 49);
  doc.text('Supervisor signature / date', M + sigW + 24, y + 38);

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex National Warrant Search  ·  Subject ${formatWarrantName(warrant)}`,
    M, H - 18,
  );

  return doc;
}

export function openNationalWarrantPdf(input: NationalWarrantPdfInput): void {
  const doc = generateNationalWarrantPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'National Warrant');
}
