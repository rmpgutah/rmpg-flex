// ═══════════════════════════════════════════════════════════════
// Forensic Case — court-ready chain-of-custody PDF.
// ───────────────────────────────────────────────────────────────
// Forensic case files are direct court-record material: defense
// counsel subpoenas them during discovery to challenge lab
// methodology, exhibit handling, and result chain-of-custody.
// The Forensic Lab page shipped with full in-app detail panels
// (case header, exhibits with custody chain, analyses, QC,
// timeline) but had no print path before this util.
//
// Same Arial + RMPG-gold visual contract as the prior court PDFs
// (evidenceItemPdf, bodycamVideoCustodyPdf, auditLogPdf,
// equipmentCustodyPdf), so multi-surface court packages have a
// consistent "RMPG record" look.
//
// Tamper-evidence: optional payload-hash footer via pdfIntegrity.
// The case PDF is the only RMPG surface where a SHA-256 payload
// hash is genuinely load-bearing — defense will want to know the
// document reflects the database row at print time, not a later
// edit. Caller passes `payloadHash` (computed via
// pdfIntegrity.computePayloadHash on the canonical case + exhibits
// + analyses bundle); we print it grouped 4-char × 4-col so a
// clerk can read it back over the phone or transcribe it to a log.
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
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';

const MT_TZ = 'America/Denver';

export interface ForensicCaseForPdf {
  id?: number | string;
  lab_number?: string;
  case_number?: string;
  title?: string;
  case_type?: string;
  status?: string;
  priority?: string;
  description?: string;
  findings?: string;
  conclusion?: string;
  notes?: string;
  requesting_agency?: string;
  requesting_officer?: string;
  lead_examiner_name?: string;
  linked_incident_number?: string;
  linked_case_number?: string;
  received_date?: string;
  due_date?: string;
  completed_date?: string;
  released_date?: string;
  created_at?: string;
}

export interface ForensicExhibitForPdf {
  id?: number;
  exhibit_number?: string;
  exhibit_type?: string;
  description?: string;
  quantity?: number | string;
  condition_received?: string;
  storage_location?: string;
  storage_temp?: string;
  collected_by?: string;
  collected_date?: string;
  collection_method?: string;
  hash_md5?: string;
  hash_sha256?: string;
  disposition?: string;
  disposition_date?: string;
  notes?: string;
  /** D1 stores this as JSON string; the page sometimes already parses it. */
  chain_of_custody?: string | ChainOfCustodyEntry[];
}

export interface ChainOfCustodyEntry {
  at?: string;
  from?: string | null;
  to?: string;
  reason?: string;
  notes?: string;
  by_id?: number;
}

export interface ForensicAnalysisForPdf {
  id?: number;
  analysis_type?: string;
  status?: string;
  methodology?: string;
  equipment_used?: string;
  results?: string;
  conclusion?: string;
  notes?: string;
  analyst_name?: string;
  started_at?: string;
  completed_at?: string;
}

export interface ForensicCasePdfInput {
  case: ForensicCaseForPdf;
  exhibits?: ForensicExhibitForPdf[];
  analyses?: ForensicAnalysisForPdf[];
  preparedBy?: string;
  /** Lowercase-hex SHA-256 over the canonical-JSON form of the case
   *  bundle. Computed by the caller via pdfIntegrity.computePayloadHash
   *  BEFORE calling this generator so the same hash that ends up in
   *  the trailer is the one a future Ed25519 signer would sign over. */
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

/** Normalise chain_of_custody (string JSON OR array OR null) into an array. */
export function parseChain(value: ForensicExhibitForPdf['chain_of_custody']): ChainOfCustodyEntry[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const ellipsize = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';

// ── PDF body ────────────────────────────────────────────────────

export function generateForensicCasePdf(input: ForensicCasePdfInput): jsPDF {
  const { case: c, exhibits = [], analyses = [], preparedBy, payloadHash } = input;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  const labelOrId = c.lab_number || c.case_number || `FC-${c.id ?? '?'}`;

  // ── Banner ────────────────────────────────────────────────
  y = drawNavyBanner(doc, {
    title: `FORENSIC CASE — ${labelOrId}`,
    subtitle: 'Forensic Lab',
    rightLine1: fmtTimestamp(new Date().toISOString()),
    rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
  });

  // ── Tamper-evidence statement ──
  doc.setFillColor(TAMPER_BG);
  doc.setDrawColor(TAMPER_BORDER);
  doc.setLineWidth(0.75);
  doc.rect(M, y, W - 2 * M, 42, 'FD');
  doc.setFont('Arial', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(TAMPER_BORDER);
  doc.text('TAMPER-EVIDENCE STATEMENT', M + 8, y + 12);
  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_DARK);
  const tamperLines = [
    'Forensic case records are append-only in chain-of-custody surfaces (exhibits, analyses, activity log).',
    'Edits to the case header and exhibit metadata generate audit_log entries with the editor identity.',
    'The payload hash printed below binds this document to the case state at the generation time shown above.',
  ];
  for (let i = 0; i < tamperLines.length; i++) {
    doc.text(tamperLines[i], M + 8, y + 22 + i * 8);
  }
  y += 52;
  doc.setLineWidth(0.5);

  // ── Optional alert: overdue ──
  const isOverdue = c.due_date && !c.completed_date && !c.released_date
    && parseTimestamp(c.due_date).getTime() < Date.now();
  if (isOverdue) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text(`CASE OVERDUE — due ${fmtDate(c.due_date)}, still open`, M + 10, y + 15);
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Case header block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('CASE', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const headerFields: Array<[string, string]> = [
    ['Title', c.title || '—'],
    ['Case Type', toDisplayLabel(c.case_type)],
    ['Status', toDisplayLabel(c.status)],
    ['Priority', toDisplayLabel(c.priority)],
    ['Lead Examiner', c.lead_examiner_name || '—'],
    ['Requesting Officer', c.requesting_officer || '—'],
    ['Agency', c.requesting_agency || '—'],
    ['Linked Incident', c.linked_incident_number || '—'],
    ['Linked Case', c.linked_case_number || '—'],
    ['Received', fmtDate(c.received_date || c.created_at)],
    ['Due', fmtDate(c.due_date)],
    ['Completed', fmtDate(c.completed_date)],
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

  // ── Description / synopsis ──
  if (c.description) {
    newPageIfNeeded(40);
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('SYNOPSIS', M, y);
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

  // ── Exhibits ──
  newPageIfNeeded(40);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text(`EXHIBITS (${exhibits.length})`, M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  if (exhibits.length === 0) {
    doc.setFont('Arial', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text('No exhibits recorded for this case.', M + 4, y + 4);
    doc.setFont('Arial', 'normal');
    y += 20;
  } else {
    for (const ex of exhibits) {
      newPageIfNeeded(80);
      // Exhibit header bar
      doc.setFillColor('#e8e8e8');
      doc.rect(M, y, W - 2 * M, 14, 'F');
      doc.setFont('Arial', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(TEXT_DARK);
      doc.text(`${ex.exhibit_number || `E-${ex.id ?? '?'}`}  ·  ${toDisplayLabel(ex.exhibit_type)}`, M + 4, y + 10);
      const dispLabel = ex.disposition ? toDisplayLabel(ex.disposition) : '—';
      doc.text(`Disposition: ${dispLabel}`, W - M - 4, y + 10, { align: 'right' });
      y += 18;

      doc.setFont('Arial', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(TEXT_DARK);
      if (ex.description) {
        const dlines = doc.splitTextToSize(ex.description, W - 2 * M - 4);
        for (const line of dlines) {
          newPageIfNeeded(10);
          doc.text(line, M + 4, y);
          y += 10;
        }
      }

      // Exhibit detail row
      const detailFields: Array<[string, string]> = [
        ['Storage', ex.storage_location || '—'],
        ['Condition', ex.condition_received || '—'],
        ['Collected', fmtDate(ex.collected_date)],
        ['Collected By', ex.collected_by || '—'],
        ['SHA-256', ex.hash_sha256 ? ellipsize(ex.hash_sha256, 32) : '—'],
        ['MD5', ex.hash_md5 || '—'],
      ];
      doc.setFontSize(7.5);
      for (let i = 0; i < detailFields.length; i += 3) {
        const cw = (W - 2 * M) / 3;
        for (let j = 0; j < 3; j++) {
          const f = detailFields[i + j];
          if (!f) continue;
          const [lbl, val] = f;
          doc.setTextColor(TEXT_MUTED);
          doc.text(lbl.toUpperCase(), M + j * cw, y);
          doc.setTextColor(TEXT_DARK);
          doc.text(ellipsize(val, 28), M + j * cw, y + 9);
        }
        y += 19;
      }

      // Chain of custody mini-table
      const chain = parseChain(ex.chain_of_custody);
      if (chain.length > 0) {
        newPageIfNeeded(20 + chain.length * 12);
        doc.setFont('Arial', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(TEXT_MUTED);
        doc.text('CHAIN OF CUSTODY', M + 4, y);
        y += 4;
        doc.setDrawColor(BORDER);
        doc.setLineWidth(0.3);
        doc.line(M + 4, y, W - M - 4, y);
        y += 8;
        doc.setFont('Arial', 'normal');
        doc.setFontSize(7.5);
        chain.forEach((entry, i) => {
          newPageIfNeeded(12);
          if (i % 2 === 1) {
            doc.setFillColor(ROW_ALT);
            doc.rect(M + 4, y - 8, W - 2 * M - 8, 12, 'F');
          }
          doc.setTextColor(TEXT_DARK);
          const tsCol = fmtTimestamp(entry.at);
          const fromTo = `${entry.from || '—'} → ${entry.to || '—'}`;
          const reason = toDisplayLabel(entry.reason);
          doc.text(tsCol, M + 8, y);
          doc.text(ellipsize(fromTo, 50), M + 130, y);
          doc.text(reason, M + 360, y);
          if (entry.notes) {
            doc.setTextColor(TEXT_MUTED);
            doc.text(ellipsize(entry.notes, 28), M + 460, y);
          }
          y += 12;
        });
        y += 4;
      }
      y += 4; // spacer between exhibits
    }
  }

  // ── Analyses ──
  newPageIfNeeded(40);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text(`ANALYSES (${analyses.length})`, M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  if (analyses.length === 0) {
    doc.setFont('Arial', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text('No analyses recorded for this case.', M + 4, y + 4);
    doc.setFont('Arial', 'normal');
    y += 20;
  } else {
    for (const a of analyses) {
      newPageIfNeeded(60);
      doc.setFillColor('#e8e8e8');
      doc.rect(M, y, W - 2 * M, 14, 'F');
      doc.setFont('Arial', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(TEXT_DARK);
      doc.text(toDisplayLabel(a.analysis_type), M + 4, y + 10);
      doc.text(toDisplayLabel(a.status), W - M - 4, y + 10, { align: 'right' });
      y += 18;

      doc.setFont('Arial', 'normal');
      doc.setFontSize(8.5);
      const aFields: Array<[string, string]> = [
        ['Analyst', a.analyst_name || '—'],
        ['Started', fmtDate(a.started_at)],
        ['Completed', fmtDate(a.completed_at)],
      ];
      const cw = (W - 2 * M) / 3;
      for (let j = 0; j < aFields.length; j++) {
        const [lbl, val] = aFields[j];
        doc.setTextColor(TEXT_MUTED);
        doc.text(lbl.toUpperCase(), M + 4 + j * cw, y);
        doc.setTextColor(TEXT_DARK);
        doc.text(ellipsize(val, 28), M + 4 + j * cw, y + 9);
      }
      y += 22;

      // Methodology + Results + Conclusion
      const longFields: Array<[string, string | undefined]> = [
        ['Methodology', a.methodology],
        ['Equipment Used', a.equipment_used],
        ['Results', a.results],
        ['Conclusion', a.conclusion],
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

  // ── Findings + Conclusion (case-level) ──
  if (c.findings || c.conclusion) {
    newPageIfNeeded(40);
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('CASE FINDINGS / CONCLUSION', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    if (c.findings) {
      doc.setFont('Arial', 'bold');
      doc.setTextColor(TEXT_MUTED);
      doc.text('FINDINGS', M, y); y += 10;
      doc.setFont('Arial', 'normal');
      doc.setTextColor(TEXT_DARK);
      const fl = doc.splitTextToSize(c.findings, W - 2 * M);
      for (const line of fl) { newPageIfNeeded(11); doc.text(line, M, y); y += 11; }
      y += 6;
    }
    if (c.conclusion) {
      doc.setFont('Arial', 'bold');
      doc.setTextColor(TEXT_MUTED);
      doc.text('CONCLUSION', M, y); y += 10;
      doc.setFont('Arial', 'normal');
      doc.setTextColor(TEXT_DARK);
      const cl = doc.splitTextToSize(c.conclusion, W - 2 * M);
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
      'This hash is computed over a canonical-JSON form of the case + exhibits + analyses at print-time. ' +
      'A different hash for the same lab number indicates the underlying record was edited after this copy was generated.'
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
  doc.text('Lead examiner signature / date', M, y + 38);
  if (preparedBy) doc.text(preparedBy, M, y + 49);
  doc.text('Reviewing supervisor signature / date', M + sigW + 24, y + 38);

  // ── Footer (every page) ──
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(TEXT_MUTED);
    const hashSnippet = payloadHash ? `  ·  hash ${payloadHash.slice(0, 8)}` : '';
    doc.text(
      `Generated ${fmtTimestamp(new Date().toISOString())}  ·  RMPG Flex Forensic Lab  ·  ${labelOrId}${hashSnippet}  ·  Page ${p} of ${pageCount}`,
      M, H - 18,
    );
  }

  return doc;
}

/** Open the generated PDF in a new browser tab. */
export function openForensicCasePdf(input: ForensicCasePdfInput): void {
  const doc = generateForensicCasePdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Forensic Case Report');
}
