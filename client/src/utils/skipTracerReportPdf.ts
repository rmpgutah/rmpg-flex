// ═══════════════════════════════════════════════════════════════
// Skip Tracer — investigator hand-off / court-prep PDF.
//
// Renders one subject's PeopleDetails (the legacy Microbilt envelope
// shape the Skip Tracker page renders) into a court-ready letter PDF:
// banner, identity block, phones, emails, addresses, related/associates,
// and an officer attribution + datestamp. Same Arial + gold pattern as
// fiCardPdf and trainingCertificatePdf — every page in the audit series
// uses one PDF generator for the canonical "investigator hand-off"
// artifact, so the cover sheet/header layout is consistent across
// SkipTracer / FI / DAR / Training / Audit / Equipment.
//
// Pure (no DOM, no apiFetch) — easy to unit-test if a regression
// reveals it later. The page-side `openSkipTracerReportPdf` wrapper
// opens the result in a new tab.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { openPdfBlob } from './openPdfDocument';
import { drawNavyBanner } from './pdfStandaloneHeader';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';

const MT_TZ = 'America/Denver';

function fmtDateTime(input: string | Date | undefined | null): string {
  if (!input) return '—';
  try {
    const d = typeof input === 'string' ? parseTimestamp(input) : input;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d) + ' MT';
  } catch { return String(input); }
}

/** Pulls the first non-empty key value off an object. The legacy
 *  Microbilt envelope used PascalCase ("Name", "Person ID", "Lives in")
 *  while local rows arrive lower_snake ("name", "person_id"); read both
 *  shapes so the same generator works for whichever data source
 *  populated the row. */
function firstOf(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return '';
}

export interface SkipTraceContext {
  /** What the operator typed into the form. Goes on the cover. */
  query: string;
  /** Which mode was active when the search ran ('name', 'phone', etc.). */
  mode: string;
  /** Optional officer-name attribution for the footer. */
  officerName?: string;
  /** Optional badge number for the footer. */
  badgeNumber?: string;
  /** Optional case/incident number this trace is being filed under. */
  caseNumber?: string;
}

/** Build the PDF for one subject. The `subject` arg is the same row
 *  the right-pane renders (PeopleDetails entry OR extended person
 *  detail from /skiptracer/person/:id). Returns the jsPDF instance so
 *  the caller can decide whether to open it, save it, or print it. */
export function generateSkipTracerReportPdf(
  subject: Record<string, unknown>,
  ctx: SkipTraceContext,
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  const name = firstOf(subject, 'Name', 'name', 'fullName') || 'UNKNOWN SUBJECT';
  const personId = firstOf(subject, 'Person ID', 'personId', 'person_id', 'id');
  const age = firstOf(subject, 'Age', 'age');
  const livesIn = firstOf(subject, 'Lives in', 'livesIn', 'lives_in');

  y = drawNavyBanner(doc, {
    title: `SKIP TRACE REPORT — ${name.toUpperCase()}`,
    subtitle: 'Investigations / Skip Trace',
    rightLine1: `Generated ${fmtDateTime(new Date())}`,
  });

  // ── Query context block ──
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('QUERY CONTEXT', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  const ctxFields: Array<[string, string]> = [
    ['Search Mode', ctx.mode.toUpperCase()],
    ['Search Input', ctx.query || '—'],
  ];
  if (ctx.caseNumber) ctxFields.push(['Case / Incident', ctx.caseNumber]);
  for (const [lbl, val] of ctxFields) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), M, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(val, M + 110, y);
    y += 14;
  }
  y += 6;

  // ── Subject identity ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('SUBJECT', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  const idFields: Array<[string, string]> = [
    ['Name', name],
    ['Person ID', personId || '—'],
    ['Age', age || '—'],
    ['Lives In', livesIn || '—'],
  ];
  for (const [lbl, val] of idFields) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), M, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(val, M + 110, y);
    y += 14;
  }
  y += 6;

  // ── List section helper ──
  const ensureRoom = (need: number) => {
    if (y + need > H - 80) { doc.addPage(); y = 48; }
  };
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    ensureRoom(40);
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text(title, M, y);
    y += 4;
    doc.setDrawColor(BORDER);
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    for (const item of items) {
      ensureRoom(14);
      doc.setTextColor(TEXT_DARK);
      // Wrap long lines so a 120-char address doesn't run off the page.
      const wrapped = doc.splitTextToSize(item, W - 2 * M - 12);
      for (const line of wrapped) {
        ensureRoom(11);
        doc.text(`• ${line}`, M, y);
        y += 11;
      }
    }
    y += 6;
  };

  // ── Phones ──
  const phoneArr = pickArray(subject, ['phones', 'phoneNumbers', 'phone_numbers', 'Phones']);
  section('PHONE NUMBERS', phoneArr.map(stringifyContactItem));

  // ── Emails ──
  const emailArr = pickArray(subject, ['emails', 'emailAddresses', 'email_addresses', 'Emails']);
  section('EMAIL ADDRESSES', emailArr.map(stringifyContactItem));

  // ── Addresses ──
  const addrArr = pickArray(subject, ['addresses', 'Addresses', 'address_history']);
  section('ADDRESSES', addrArr.map(stringifyAddressItem));

  // ── Relatives / Associates ──
  const relArr = pickArray(subject, ['relatives', 'Relatives', 'associates', 'Associates']);
  section('RELATIVES / ASSOCIATES', relArr.map((it) => firstOf(it as Record<string, unknown>, 'Name', 'name', 'fullName') || String(it)));

  // ── Used to live in / Related to scalar (Microbilt envelope) ──
  const usedTo = firstOf(subject, 'Used to live in', 'usedToLiveIn');
  const relatedTo = firstOf(subject, 'Related to', 'relatedTo');
  if (usedTo) section('PRIOR ADDRESSES', usedTo.split(',').map(s => s.trim()).filter(Boolean));
  if (relatedTo) section('RELATED TO', relatedTo.split(',').map(s => s.trim()).filter(Boolean));

  // ── Audit footer ──
  if (y > H - 120) { doc.addPage(); y = 48; }
  y = H - 80;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text(
    'This report aggregates database hits from RMPG Flex sources current at the time of generation. ' +
    'Skip-trace results are investigative leads, not adjudicated facts; corroborate via independent ' +
    'verification before action.',
    M, y, { maxWidth: W - 2 * M },
  );
  y = H - 18;
  doc.setFontSize(7);
  const footRight = ctx.officerName
    ? `${ctx.officerName}${ctx.badgeNumber ? ` #${ctx.badgeNumber}` : ''}  ·  ${fmtDateTime(new Date())}`
    : fmtDateTime(new Date());
  doc.text('RMPG Flex  ·  Skip Trace Report', M, y);
  doc.text(footRight, W - M, y, { align: 'right' });

  return doc;
}

function pickArray(obj: Record<string, unknown>, keys: string[]): unknown[] {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v) && v.length > 0) return v;
  }
  return [];
}

function stringifyContactItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    return firstOf(o, 'number', 'phone', 'address', 'email', 'value') || JSON.stringify(o);
  }
  return String(item);
}

function stringifyAddressItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    const street = firstOf(o, 'address', 'street', 'line1');
    const city = firstOf(o, 'city');
    const st = firstOf(o, 'state', 'region');
    const zip = firstOf(o, 'postal_code', 'zip', 'zipcode');
    const parts = [street, [city, st].filter(Boolean).join(', '), zip].filter(Boolean);
    return parts.join('  ') || JSON.stringify(o);
  }
  return String(item);
}

/** Open the generated PDF in a new browser tab. */
export function openSkipTracerReportPdf(
  subject: Record<string, unknown>,
  ctx: SkipTraceContext,
): void {
  const doc = generateSkipTracerReportPdf(subject, ctx);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Skip Tracer Report');
}
