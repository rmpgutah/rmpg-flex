// ═══════════════════════════════════════════════════════════════
// NSOPW Offender — court-ready Offender Identification Card PDF.
// ------------------------------------------------------------
// State/territory Sex Offender Registry data is statutory court-
// record material (subject identification, address of record,
// conviction summary, jurisdiction tier). The /nsopw cross-ref
// panel surfaced the data on screen but had no print path; officers
// preparing a court package or supervisor-review packet had to
// screenshot the offender card. This util fixes that — same Arial
// + RMPG-gold + signature-block idiom as fiCardPdf / evidenceItemPdf
// / criminalHistoryPdf.
//
// CAVEAT footer prints the NSOPW disclaimer that a point-in-time
// query is NOT a clearance — the same caveat the on-screen panel
// shows when there are zero matches. Without this caveat in print
// the document misleads recipients about what an empty/clean result
// means.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { drawNavyBanner } from './pdfStandaloneHeader';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { openPdfBlob } from './openPdfDocument';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';
const WARN_BG = '#fff7e6';
const WARN_BORDER = '#b45309';

const MT_TZ = 'America/Denver';

/** Subset of NSOPW classified-offender fields the PDF consumes. Mirrors the
 *  OffenderCard / Classified shapes in NsopwSearchPanel.tsx, but flat so the
 *  generator doesn't need to import that component's interfaces. */
export interface OffenderPdfInput {
  offender: {
    nsopwOffenderId?: string | null;
    jurisdiction?: string | null;
    jurisdictionLabel?: string | null;
    firstName?: string | null;
    middleName?: string | null;
    lastName?: string | null;
    dateOfBirth?: string | null;
    sex?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    offense?: string | null;
    riskLevel?: string | null;
    tier?: number | null;
    registrationStatus?: string | null;
    detailUrl?: string | null;
    rowId?: number | null;
    personId?: number | null;
    linkedProperties?: Array<{ propertyId: number; locationType: string; locationName: string | null }> | null;
  };
  classification?: 'confirmed' | 'possible' | 'excluded' | null;
  score?: number | null;
  matchedFields?: string[] | null;
  reason?: string | null;
  /** Optional photograph bytes (data URL or fetched blob URL). Embedded into
   *  the card when supplied. */
  photoDataUrl?: string | null;
  preparedBy?: string | null;
  /** The search query that produced this card, for the cross-ref footer line. */
  queryContext?: { surname?: string | null; forename?: string | null; dob?: string | null } | null;
}

function fmtDate(input: string | null | undefined): string {
  if (!input) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
    }).format(parseTimestamp(input));
  } catch { return String(input); }
}

function fmtDateTime(input: string | null | undefined): string {
  if (!input) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(parseTimestamp(input)) + ' MT';
  } catch { return String(input); }
}

/** Public for testing. Builds the subject's full name as a single string in
 *  "LAST, FIRST MIDDLE" order — the convention used on warrant / registry
 *  print-outs (last-name-first for alphabetical filing). */
export function formatSubjectName(o: OffenderPdfInput['offender']): string {
  const last = (o.lastName || '').trim().toUpperCase();
  const first = (o.firstName || '').trim();
  const middle = (o.middleName || '').trim();
  if (!last && !first) return '—';
  const head = last || '—';
  const tail = [first, middle].filter(Boolean).join(' ');
  return tail ? `${head}, ${tail}` : head;
}

/** Public for testing. One-line mailing-style address from the offender's
 *  registered location. Returns '—' if every component is empty. */
export function formatAddress(o: OffenderPdfInput['offender']): string {
  const parts = [o.address, o.city, [o.state, o.zip].filter(Boolean).join(' ')]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

/** Public for testing. The header card the operator uses to identify the
 *  classification of the match at a glance. Maps to a banner background +
 *  banner text. Mirrors the on-screen tone (red=confirmed, amber=possible,
 *  grey=excluded/unknown). */
export function classificationBanner(c: OffenderPdfInput['classification']): {
  label: string; bg: string; fg: string;
} {
  if (c === 'confirmed') return { label: 'CONFIRMED MATCH', bg: ALERT_BG, fg: ALERT_BORDER };
  if (c === 'possible') return { label: 'POSSIBLE MATCH — OFFICER REVIEW REQUIRED', bg: WARN_BG, fg: WARN_BORDER };
  if (c === 'excluded') return { label: 'EXCLUDED CANDIDATE', bg: '#f0f0f0', fg: TEXT_MUTED };
  return { label: 'OFFENDER RECORD', bg: '#f0f0f0', fg: TEXT_MUTED };
}

/** Public for testing. Word-wraps a long string into lines that fit `maxChars`
 *  per line. Preserves explicit \n breaks. Used for the offense + caveat blocks. */
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

const ellipsize = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1) + '…');

export function generateOffenderRegistrationCardPdf(input: OffenderPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { offender: o, classification, score, matchedFields, reason, preparedBy, photoDataUrl, queryContext } = input;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  // Banner
  y = drawNavyBanner(doc, {
    title: 'NSOPW OFFENDER IDENTIFICATION CARD',
    subtitle: 'Sex Offender Registry Cross-Reference',
    rightLine1: fmtDateTime(new Date().toISOString()),
    rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
  });

  // Classification banner (red / amber / grey based on match strength)
  const c = classificationBanner(classification ?? null);
  doc.setFillColor(c.bg);
  doc.setDrawColor(c.fg);
  doc.setLineWidth(0.75);
  doc.rect(M, y, W - 2 * M, 22, 'FD');
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(c.fg);
  doc.text(c.label, M + 10, y + 15);
  if (typeof score === 'number' && Number.isFinite(score)) {
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.text(`score ${score.toFixed(2)}`, W - M - 10, y + 15, { align: 'right' });
  }
  y += 30;
  doc.setLineWidth(0.5);

  // ── Layout: left photo column, right subject block ──
  const photoW = 110;
  const photoH = 140;
  const photoX = M;
  const photoY = y;

  if (photoDataUrl) {
    try {
      // jsPDF auto-detects JPEG vs PNG from the data URL header.
      doc.addImage(photoDataUrl, 'AUTO' as any, photoX, photoY, photoW, photoH);
    } catch {
      // Fall through to placeholder on any decode failure.
      doc.setDrawColor(BORDER);
      doc.setFillColor('#ececec');
      doc.rect(photoX, photoY, photoW, photoH, 'FD');
      doc.setTextColor(TEXT_MUTED);
      doc.setFontSize(8);
      doc.text('photo unavailable', photoX + photoW / 2, photoY + photoH / 2, { align: 'center' });
    }
  } else {
    doc.setDrawColor(BORDER);
    doc.setFillColor('#ececec');
    doc.rect(photoX, photoY, photoW, photoH, 'FD');
    doc.setTextColor(TEXT_MUTED);
    doc.setFontSize(8);
    doc.text('no photo on file', photoX + photoW / 2, photoY + photoH / 2, { align: 'center' });
  }

  // Subject block (right of photo)
  const subjectX = M + photoW + 16;
  const subjectW = W - M - subjectX;
  let sy = photoY;
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('SUBJECT', subjectX, sy);
  sy += 4;
  doc.setDrawColor(BORDER);
  doc.line(subjectX, sy, subjectX + subjectW, sy);
  sy += 12;

  const subjectFields: Array<[string, string]> = [
    ['Name', formatSubjectName(o)],
    ['DOB', fmtDate(o.dateOfBirth)],
    ['Sex', (o.sex || '—').toUpperCase()],
    ['Jurisdiction', o.jurisdictionLabel || o.jurisdiction || '—'],
    ['Offender ID', o.nsopwOffenderId || '—'],
    ['Tier / Risk', [o.tier ? `Tier ${o.tier}` : null, o.riskLevel].filter(Boolean).join(' · ') || '—'],
    ['Registration', (o.registrationStatus || '—').toUpperCase()],
  ];
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  for (const [lbl, val] of subjectFields) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), subjectX, sy);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val, 60), subjectX + 72, sy);
    sy += 13;
  }

  // Reserve enough vertical space so the subject column or photo column
  // (whichever is taller) doesn't overlap the next section.
  y = Math.max(photoY + photoH, sy) + 12;

  // ── Registered Address block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('REGISTERED ADDRESS', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_DARK);
  const addr = formatAddress(o);
  const addrLines = wrapText(addr, 100);
  for (const line of addrLines) {
    doc.text(line, M, y);
    y += 12;
  }
  y += 4;

  // ── Offense / Conviction block ──
  if (o.offense) {
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('CONVICTION / OFFENSE', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    const offLines = wrapText(o.offense, 95);
    for (const line of offLines) {
      if (y > H - 130) { doc.addPage(); y = 48; }
      doc.text(line, M, y);
      y += 12;
    }
    y += 4;
  }

  // ── Match metadata + RMPG records linkage ──
  if (matchedFields?.length || reason || o.personId || (o.linkedProperties?.length ?? 0) > 0) {
    if (y > H - 130) { doc.addPage(); y = 48; }
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('CROSS-REFERENCE METADATA', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);

    const metaRows: Array<[string, string]> = [];
    if (queryContext) {
      const q = [
        queryContext.surname ? `surname=${queryContext.surname}` : null,
        queryContext.forename ? `forename=${queryContext.forename}` : null,
        queryContext.dob ? `dob=${queryContext.dob}` : null,
      ].filter(Boolean).join(' · ');
      if (q) metaRows.push(['Query', q]);
    }
    if (matchedFields?.length) metaRows.push(['Matched On', matchedFields.join(', ')]);
    if (reason) metaRows.push(['Reason', reason]);
    if (o.personId) metaRows.push(['RMPG Person', `persons.id=${o.personId}`]);
    if (o.linkedProperties?.length) {
      metaRows.push([
        'Linked Properties',
        o.linkedProperties
          .map((p) => `${p.locationType}${p.locationName ? `: ${p.locationName}` : ''} (#${p.propertyId})`)
          .join('; '),
      ]);
    }
    if (o.detailUrl) metaRows.push(['Jurisdiction Record', o.detailUrl]);

    for (const [lbl, val] of metaRows) {
      doc.setTextColor(TEXT_MUTED);
      doc.text(lbl.toUpperCase(), M, y);
      doc.setTextColor(TEXT_DARK);
      const valLines = wrapText(val, 78);
      for (let i = 0; i < valLines.length; i++) {
        if (y > H - 130) { doc.addPage(); y = 48; }
        doc.text(valLines[i], M + 130, y);
        if (i < valLines.length - 1) y += 12;
      }
      y += 14;
    }
  }

  // ── NSOPW point-in-time caveat (always present) ──
  if (y > H - 110) { doc.addPage(); y = 48; }
  y += 6;
  doc.setFillColor(WARN_BG);
  doc.setDrawColor(WARN_BORDER);
  doc.setLineWidth(0.6);
  doc.rect(M, y, W - 2 * M, 44, 'FD');
  doc.setFont('Arial', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(WARN_BORDER);
  doc.text('NSOPW POINT-IN-TIME ADVISORY', M + 8, y + 12);
  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_DARK);
  const caveat = 'This card reflects the National Sex Offender Public Website (NSOPW) federated query result at the time of generation. Subjects newly registered after the most recent jurisdiction sync (within 7 days for most states) may not appear. An empty NSOPW result is NOT a clearance — verify with the source jurisdiction before any operational decision based on absence of record.';
  const caveatLines = wrapText(caveat, 105);
  let cy = y + 22;
  for (const line of caveatLines) {
    doc.text(line, M + 8, cy);
    cy += 10;
  }
  y += 54;
  doc.setLineWidth(0.5);

  // ── Signature block ──
  if (y > H - 90) { doc.addPage(); y = 48; }
  y += 6;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;
  doc.line(M, y + 28, M + sigW, y + 28);
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Reviewing officer signature', M, y + 38);
  doc.text(preparedBy || '—', M, y + 49);
  doc.text('Supervisor signature / date', M + sigW + 24, y + 38);

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  const footerId = o.rowId != null
    ? `nsopw.id=${o.rowId}`
    : `${o.jurisdiction || '?'}:${o.nsopwOffenderId || '?'}`;
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex NSOPW Cross-Reference  ·  ${footerId}`,
    M, H - 18,
  );

  // Mark ROW_ALT as referenced so tree-shaking doesn't drop the alt-row
  // color constant if a future revision adds a multi-row history table.
  void ROW_ALT;

  return doc;
}

export function openOffenderRegistrationCardPdf(input: OffenderPdfInput): void {
  const doc = generateOffenderRegistrationCardPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Offender Registration Card');
}
