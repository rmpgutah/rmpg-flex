// ═══════════════════════════════════════════════════════════════
// Internal Affairs Complaint — court-ready PDF.
// ───────────────────────────────────────────────────────────────
// IA complaint files are direct court / civil-rights material:
// they are routinely subpoenaed during 42 USC 1983 / Title VII
// claims, DOJ pattern-or-practice investigations, and POST board
// decertification reviews. The page shipped without a print path
// at all — supervisors had to screenshot the form to send a
// complaint to the IA review board.
//
// Same Arial + RMPG-gold visual contract as the prior court PDFs
// (forensicCasePdf, evidenceItemPdf, bodycamVideoCustodyPdf,
// auditLogPdf, equipmentCustodyPdf) so multi-surface court
// packages have a consistent "RMPG record" look.
//
// Privacy / confidentiality:
//  - Header explicitly flags the document as CONFIDENTIAL —
//    INTERNAL AFFAIRS WORK PRODUCT. POST 51-9-301 + Utah GRAMA
//    treat IA records as protected unless released by court order.
//  - The complainant identity is reproduced (we are the agency
//    holding the record), but the page itself is presumptively
//    protected when shared outside the IA loop.
//
// Tamper-evidence: SHA-256 payload hash via pdfIntegrity so a
// printed copy can be matched back to its source row, and a
// later edit produces a different hash on regeneration.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { drawNavyBanner } from './pdfStandaloneHeader';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { formatHashGrouped } from './pdfIntegrity';
import { toDisplayLabel } from './formatters';
import { openPdfBlob } from './openPdfDocument';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const TAMPER_BG = '#fef9e8';
const TAMPER_BORDER = '#b45309';
const CONFIDENTIAL_BG = '#fef1f0';
const CONFIDENTIAL_BORDER = '#b91c1c';

const MT_TZ = 'America/Denver';

export interface IaComplaintForPdf {
  id?: number | string;
  complaint_number?: string;
  complainant_name?: string | null;
  complainant_contact?: string | null;
  subject_officer_id?: number | null;
  subject_officer_name?: string | null;
  complaint_type?: string | null;
  description?: string | null;
  incident_date?: string | null;
  incident_location?: string | null;
  witnesses?: string | null;
  evidence_list?: string | null;
  status?: string | null;
  assigned_to?: number | null;
  assigned_to_name?: string | null;
  finding?: string | null;
  discipline?: string | null;
  closed_date?: string | null;
  created_by?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface IaInvestigationForPdf {
  id?: number;
  complaint_id?: number;
  investigator_id?: number | null;
  investigator_name?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  summary?: string | null;
  findings?: string | null;
  recommendations?: string | null;
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  status?: string | null;
}

export interface IaComplaintPdfInput {
  complaint: IaComplaintForPdf;
  investigations?: IaInvestigationForPdf[];
  preparedBy?: string;
  /** Lowercase-hex SHA-256 over the canonical-JSON form of the
   *  complaint bundle. Computed by the caller via
   *  pdfIntegrity.computePayloadHash BEFORE calling this
   *  generator so the same hash that ends up in the trailer is
   *  the one a future Ed25519 signer would sign over. */
  payloadHash?: string;
}

// ── Public helpers (unit-tested) ─────────────────────────────────

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

export function fmtDate(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
    }).format(parseTimestamp(input));
  } catch { return String(input); }
}

/** Word-wrap a string into lines that fit `maxChars` per line. */
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

/** Format snake_case → Title Case for action / status / type labels. */
export function prettyLabel(input: string | undefined | null): string {
  if (!input) return '—';
  return toDisplayLabel(input);
}

const ellipsize = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';

/**
 * Is this complaint past 90 days from filing without a closed_date?
 * 90 days is the soft IA review deadline most agencies adopt for
 * adjudication; surfaces an OVERDUE banner so the reader sees the
 * complaint is aged.
 */
export function isOverdue(c: IaComplaintForPdf, nowMs: number = Date.now()): boolean {
  if (c.closed_date) return false;
  const closedStatuses = new Set(['closed', 'sustained', 'not_sustained', 'exonerated', 'unfounded']);
  if (c.status && closedStatuses.has(c.status)) return false;
  if (!c.created_at) return false;
  try {
    const filedMs = parseTimestamp(c.created_at).getTime();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    return (nowMs - filedMs) > ninetyDaysMs;
  } catch { return false; }
}

// ── PDF body ────────────────────────────────────────────────────

export function generateAffairsComplaintPdf(input: IaComplaintPdfInput): jsPDF {
  const { complaint: c, investigations = [], preparedBy, payloadHash } = input;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  const labelOrId = c.complaint_number || `IA-${c.id ?? '?'}`;

  // ── Banner ────────────────────────────────────────────────
  y = drawNavyBanner(doc, {
    title: `INTERNAL AFFAIRS COMPLAINT — ${labelOrId}`,
    subtitle: 'Office of Professional Standards',
    rightLine1: fmtTimestamp(new Date().toISOString()),
    rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
  });

  // ── Confidentiality banner ── (always present — IA records are
  // presumptively protected under UT GRAMA + POST 51-9-301).
  doc.setFillColor(CONFIDENTIAL_BG);
  doc.setDrawColor(CONFIDENTIAL_BORDER);
  doc.setLineWidth(0.75);
  doc.rect(M, y, W - 2 * M, 38, 'FD');
  doc.setFont('Arial', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(CONFIDENTIAL_BORDER);
  doc.text('CONFIDENTIAL — INTERNAL AFFAIRS WORK PRODUCT', M + 8, y + 12);
  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_DARK);
  const confLines = [
    'Protected under Utah GRAMA §63G-2-302 + POST §53-6-211 unless released by court order, lawful discovery, or written consent of the agency head.',
    'Unauthorized disclosure may constitute a class B misdemeanor + grounds for civil liability.',
  ];
  for (let i = 0; i < confLines.length; i++) {
    doc.text(confLines[i], M + 8, y + 22 + i * 8);
  }
  y += 48;
  doc.setLineWidth(0.5);

  // ── Tamper-evidence statement ──
  doc.setFillColor(TAMPER_BG);
  doc.setDrawColor(TAMPER_BORDER);
  doc.setLineWidth(0.75);
  doc.rect(M, y, W - 2 * M, 34, 'FD');
  doc.setFont('Arial', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(TAMPER_BORDER);
  doc.text('TAMPER-EVIDENCE STATEMENT', M + 8, y + 12);
  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_DARK);
  const tamperLines = [
    'Complaint edits, investigation updates, and disposition changes generate audit_log entries with the editor identity.',
    'The payload hash printed below binds this document to the complaint state at the generation time shown above.',
  ];
  for (let i = 0; i < tamperLines.length; i++) {
    doc.text(tamperLines[i], M + 8, y + 22 + i * 8);
  }
  y += 44;
  doc.setLineWidth(0.5);

  // ── Optional alert: aged (>90d without disposition) ──
  if (isOverdue(c)) {
    doc.setFillColor(CONFIDENTIAL_BG);
    doc.setDrawColor(CONFIDENTIAL_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(CONFIDENTIAL_BORDER);
    doc.text(`COMPLAINT AGED — filed ${fmtDate(c.created_at)}, still open after 90 days`, M + 10, y + 15);
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Complaint header block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('COMPLAINT', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const headerFields: Array<[string, string]> = [
    ['Complaint Type', prettyLabel(c.complaint_type)],
    ['Status', prettyLabel(c.status)],
    ['Complainant', c.complainant_name || '—'],
    ['Complainant Contact', c.complainant_contact || '—'],
    ['Subject Officer', c.subject_officer_name || (c.subject_officer_id ? `Officer #${c.subject_officer_id}` : '—')],
    ['Assigned Investigator', c.assigned_to_name || (c.assigned_to ? `User #${c.assigned_to}` : '—')],
    ['Incident Date', fmtDate(c.incident_date)],
    ['Incident Location', c.incident_location || '—'],
    ['Filed', fmtTimestamp(c.created_at)],
    ['Closed', fmtDate(c.closed_date)],
  ];
  const colW = (W - 2 * M) / 2;
  for (let i = 0; i < headerFields.length; i += 2) {
    const [lbl1, val1] = headerFields[i];
    const [lbl2, val2] = headerFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val1, 60), M, y + 11);
    if (val2) doc.text(ellipsize(val2, 60), M + colW, y + 11);
    y += 24;
  }

  const newPageIfNeeded = (need: number) => {
    if (y + need > H - 80) { doc.addPage(); y = 48; }
  };

  // ── Allegation / description ──
  if (c.description) {
    newPageIfNeeded(40);
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('ALLEGATION', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    const lines = doc.splitTextToSize(c.description, W - 2 * M);
    for (const line of lines) {
      newPageIfNeeded(11);
      doc.text(line, M, y);
      y += 11;
    }
    y += 6;
  }

  // ── Witnesses ──
  if (c.witnesses) {
    newPageIfNeeded(30);
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('WITNESSES', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    const lines = doc.splitTextToSize(c.witnesses, W - 2 * M);
    for (const line of lines) {
      newPageIfNeeded(11);
      doc.text(line, M, y);
      y += 11;
    }
    y += 6;
  }

  // ── Evidence list ──
  if (c.evidence_list) {
    newPageIfNeeded(30);
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('EVIDENCE', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    const lines = doc.splitTextToSize(c.evidence_list, W - 2 * M);
    for (const line of lines) {
      newPageIfNeeded(11);
      doc.text(line, M, y);
      y += 11;
    }
    y += 6;
  }

  // ── Investigations ──
  newPageIfNeeded(40);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text(`INVESTIGATIONS (${investigations.length})`, M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  if (investigations.length === 0) {
    doc.setFont('Arial', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text('No investigations recorded for this complaint.', M + 4, y + 4);
    doc.setFont('Arial', 'normal');
    y += 20;
  } else {
    for (const inv of investigations) {
      newPageIfNeeded(60);
      doc.setFillColor('#e8e8e8');
      doc.rect(M, y, W - 2 * M, 14, 'F');
      doc.setFont('Arial', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(TEXT_DARK);
      doc.text(`Investigation #${inv.id ?? '?'}  ·  ${prettyLabel(inv.status)}`, M + 4, y + 10);
      doc.text(inv.investigator_name || '—', W - M - 4, y + 10, { align: 'right' });
      y += 18;

      doc.setFont('Arial', 'normal');
      doc.setFontSize(8.5);
      const invFields: Array<[string, string]> = [
        ['Started', fmtTimestamp(inv.started_at)],
        ['Completed', fmtTimestamp(inv.completed_at)],
        ['Reviewed', fmtTimestamp(inv.reviewed_at)],
      ];
      const cw = (W - 2 * M) / 3;
      for (let j = 0; j < invFields.length; j++) {
        const [lbl, val] = invFields[j];
        doc.setTextColor(TEXT_MUTED);
        doc.text(lbl.toUpperCase(), M + 4 + j * cw, y);
        doc.setTextColor(TEXT_DARK);
        doc.text(ellipsize(val, 28), M + 4 + j * cw, y + 9);
      }
      y += 22;

      const longFields: Array<[string, string | undefined | null]> = [
        ['Summary', inv.summary],
        ['Findings', inv.findings],
        ['Recommendations', inv.recommendations],
      ];
      for (const [lbl, val] of longFields) {
        if (!val) continue;
        newPageIfNeeded(20);
        doc.setFont('Arial', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(TEXT_MUTED);
        doc.text(lbl.toUpperCase(), M + 4, y);
        y += 10;
        doc.setFont('Arial', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(TEXT_DARK);
        const lines = doc.splitTextToSize(val, W - 2 * M - 8);
        for (const line of lines) {
          newPageIfNeeded(10);
          doc.text(line, M + 4, y);
          y += 10;
        }
        y += 4;
      }
      y += 4;
    }
  }

  // ── Finding + Discipline (case-level disposition) ──
  if (c.finding || c.discipline) {
    newPageIfNeeded(40);
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('DISPOSITION', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    if (c.finding) {
      doc.setFont('Arial', 'bold');
      doc.setTextColor(TEXT_MUTED);
      doc.text('FINDING', M, y); y += 10;
      doc.setFont('Arial', 'normal');
      doc.setTextColor(TEXT_DARK);
      const fl = doc.splitTextToSize(c.finding, W - 2 * M);
      for (const line of fl) { newPageIfNeeded(11); doc.text(line, M, y); y += 11; }
      y += 6;
    }
    if (c.discipline) {
      doc.setFont('Arial', 'bold');
      doc.setTextColor(TEXT_MUTED);
      doc.text('DISCIPLINE', M, y); y += 10;
      doc.setFont('Arial', 'normal');
      doc.setTextColor(TEXT_DARK);
      const cl = doc.splitTextToSize(c.discipline, W - 2 * M);
      for (const line of cl) { newPageIfNeeded(11); doc.text(line, M, y); y += 11; }
      y += 6;
    }
  }

  // ── Payload-hash trailer (tamper-evidence binding) ──
  newPageIfNeeded(70);
  y += 6;
  doc.setFont('Arial', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_DARK);
  doc.text('DOCUMENT INTEGRITY (SHA-256 PAYLOAD HASH)', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  if (payloadHash) {
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    const lines = formatHashGrouped(payloadHash);
    for (const line of lines) {
      newPageIfNeeded(12);
      doc.text(line, M, y);
      y += 12;
    }
    y += 4;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(TEXT_MUTED);
    const integExplainer = (
      'This hash is computed over a canonical-JSON form of the complaint + investigations at print-time. ' +
      'A different hash for the same complaint number indicates the underlying record was edited after this copy was generated.'
    );
    const explLines = doc.splitTextToSize(integExplainer, W - 2 * M);
    for (const line of explLines) { newPageIfNeeded(10); doc.text(line, M, y); y += 10; }
  } else {
    doc.setFont('Arial', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(TEXT_MUTED);
    doc.text('— payload hash not computed —', M, y);
    y += 12;
  }

  // ── Signature block ──
  newPageIfNeeded(70);
  y += 14;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;
  doc.line(M, y + 28, M + sigW, y + 28);
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('IA investigator signature / date', M, y + 38);
  if (preparedBy) doc.text(preparedBy, M, y + 49);
  doc.text('Reviewing supervisor / agency head signature / date', M + sigW + 24, y + 38);

  // ── Footer (every page) ──
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(TEXT_MUTED);
    const hashSnippet = payloadHash ? `  ·  hash ${payloadHash.slice(0, 8)}` : '';
    doc.text(
      `Generated ${fmtTimestamp(new Date().toISOString())}  ·  RMPG Flex Internal Affairs  ·  ${labelOrId}${hashSnippet}  ·  CONFIDENTIAL  ·  Page ${p} of ${pageCount}`,
      M, H - 18,
    );
  }

  return doc;
}

/** Open the generated PDF in a new browser tab. */
export function openAffairsComplaintPdf(input: IaComplaintPdfInput): void {
  const doc = generateAffairsComplaintPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Affairs Complaint');
}
// Mark the ROW_ALT constant as used (reserved for future investigation
// alt-row striping; keeps it in the same visual contract as the
// forensic/audit PDFs which already use it).
void ROW_ALT;
