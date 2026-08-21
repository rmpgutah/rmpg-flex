// ═══════════════════════════════════════════════════════════════
// Document Intake — clerk's pre-save review-report PDF.
// ───────────────────────────────────────────────────────────────
// DocumentIntakePage (Page 57 of the full-app frontend pass) lets
// a clerk drop a court PDF / FI card / supplement, OCR-extracts
// labelled fields, and posts them to /api/<destination> after the
// clerk verifies each value. The "Download JSON" fallback already
// existed for unmapped kinds, but there was no human-readable
// print for what got extracted — a supervisor reviewing the intake
// queue, or a defense-discovery responder asked for "what was
// pulled from this packet before it landed in records," had no
// paper trail.
//
// This util emits that paper trail: a one-pager summarizing the
// source PDF, detected kind / tier / overall confidence, every
// extracted field with its per-field confidence + matched anchor +
// final value (which the clerk may have edited from the OCR'd
// original), and the raw-text preview so a downstream reviewer
// can spot-check that the extraction didn't lose context.
//
// Visual contract matches taskPdf / auditLogPdf / forensicCasePdf
// (RMPG-gold Arial banner, MT timestamps, "RMPG Flex — confidential
// law-enforcement record" footer) so a court packet pulled from
// several surfaces reads as one report.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp, localToday } from './dateUtils';
import { drawNavyBanner } from './pdfStandaloneHeader';

const RMPG_GOLD = '#d4a017';
const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';

// Per-field confidence backgrounds — same semantic colors the
// reviewer uses on-screen so the PDF reads as a printed copy of
// what the clerk saw, not a different ranking.
const HIGH_BG = '#e8f6ef';   // ≥ 0.80
const MID_BG  = '#fef7e0';   // ≥ 0.50
const LOW_BG  = '#fde8e8';   // > 0.00
const ZERO_BG = '#ffffff';   // not found (no anchor matched)

const MT_TZ = 'America/Denver';

export interface IntakeFieldForPdf {
  key: string;
  value: string;                // final value (may have been edited)
  confidence: number;           // 0..1
  matchedAnchor?: string | null;
  originalValue?: string;       // OCR'd value before clerk edits
}

export interface IntakePdfInput {
  /** Original source filename (the user-dropped PDF). */
  filename: string;
  /** Detected document kind (court_warrant, fi_card, ...). */
  kind: string;
  /** 'implemented' = covered field set; 'stub' = low coverage. */
  tier: 'implemented' | 'stub';
  /** Overall extraction confidence, 0..1. */
  confidence: number;
  pageCount: number;
  usedOcr: boolean;
  fields: IntakeFieldForPdf[];
  /** Truncated raw-text preview the extractor returned. */
  rawTextPreview?: string;
  courtCategory?: string | null;
  state?: string | null;
  /** The clerk who reviewed the extraction (for the signature block). */
  exportedBy?: string;
}

// ── Public helpers (unit-tested) ─────────────────────────────────

/** Format an ISO/SQLite timestamp as "YYYY-MM-DD HH:MM MT". */
export function fmtTimestamp(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    const d = parseTimestamp(input);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: MT_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} MT`;
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

/** Bucket a 0..1 confidence into the same band the reviewer UI
 *  uses, returning a printable label + a row background. */
export function confidenceBand(c: number): { label: string; bg: string; pct: string } {
  if (c >= 0.80) return { label: 'HIGH',   bg: HIGH_BG, pct: `${Math.round(c * 100)}%` };
  if (c >= 0.50) return { label: 'MEDIUM', bg: MID_BG,  pct: `${Math.round(c * 100)}%` };
  if (c >   0  ) return { label: 'LOW',    bg: LOW_BG,  pct: `${Math.round(c * 100)}%` };
  return         { label: 'NOT FOUND',     bg: ZERO_BG, pct: '—' };
}

/** Build the suggested filename: kind + first-8 of source name + date.
 *  Mirrors the conservative single-line spec generators use. */
export function suggestFilename(kind: string, source: string): string {
  const safeKind = (kind || 'unknown').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 24);
  const stem = (source || 'document').replace(/\.pdf$/i, '').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 24);
  const ymd = localToday();
  return `intake-${safeKind}-${stem}-${ymd}.pdf`;
}

// ── PDF body ────────────────────────────────────────────────────

export function generateDocumentIntakePdf(input: IntakePdfInput): jsPDF {
  const {
    filename, kind, tier, confidence, pageCount, usedOcr,
    fields, rawTextPreview, courtCategory, state, exportedBy,
  } = input;

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  y = drawNavyBanner(doc, {
    title: 'DOCUMENT INTAKE — EXTRACTION REPORT',
    subtitle: 'Records Intake',
    rightLine1: `Generated ${fmtTimestamp(new Date().toISOString())}`,
  });

  // ── Source / detection summary ─────────────────────────────────
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const headerBoxH = 78;
  doc.rect(M, y, W - 2 * M, headerBoxH);

  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('SOURCE FILE',     M + 8,        y + 12);
  doc.text('DETECTED KIND',   M + 200,      y + 12);
  doc.text('TIER',            M + 360,      y + 12);
  doc.text('CONFIDENCE',      M + 430,      y + 12);

  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  const fnameLines = wrapText(filename || '—', 28).slice(0, 2);
  let fy = y + 26;
  for (const ln of fnameLines) {
    doc.text(ln, M + 8, fy);
    fy += 12;
  }
  doc.text(kind || '—', M + 200, y + 26);
  doc.text(tier === 'implemented' ? 'IMPLEMENTED' : 'STUB (LOW)', M + 360, y + 26);
  const summaryBand = confidenceBand(confidence);
  doc.text(`${summaryBand.pct}  ${summaryBand.label}`, M + 430, y + 26);

  // Second row of summary
  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('PAGES',           M + 8,        y + 48);
  doc.text('OCR USED',        M + 80,       y + 48);
  doc.text('COURT CATEGORY',  M + 200,      y + 48);
  doc.text('STATE',           M + 360,      y + 48);

  doc.setFont('Arial', 'bold');
  doc.setTextColor(TEXT_DARK);
  doc.text(String(pageCount || 0), M + 8,  y + 62);
  doc.text(usedOcr ? 'YES (fallback)' : 'NO (born-digital)', M + 80, y + 62);
  doc.text(courtCategory || '—',   M + 200, y + 62);
  doc.text(state || '—',           M + 360, y + 62);

  y += headerBoxH + 12;

  // ── Field table ────────────────────────────────────────────────
  // Columns: Field | Value | OCR original | Conf
  type Col = { key: 'field' | 'value' | 'original' | 'conf'; label: string; width: number };
  const tableW = W - 2 * M;
  const cols: Col[] = [
    { key: 'field',    label: 'Field',          width: 130 },
    { key: 'value',    label: 'Final value',    width: 200 },
    { key: 'original', label: 'OCR original',   width: 130 },
    { key: 'conf',     label: 'Conf',           width: tableW - 460 },
  ];

  const headerH = 16;
  const rowMinH = 18;

  function drawHeader() {
    doc.setFillColor(RMPG_GOLD);
    doc.rect(M, y, tableW, headerH, 'F');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    let x = M + 6;
    for (const c of cols) {
      doc.text(c.label, x, y + 11);
      x += c.width;
    }
    y += headerH;
  }

  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text(`Extracted fields (${fields.length})`, M, y);
  y += 14;
  drawHeader();

  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);

  if (fields.length === 0) {
    doc.setTextColor(TEXT_MUTED);
    doc.text('No fields extracted (classifier returned an empty set).', M + 6, y + 14);
    y += rowMinH;
  }

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const band = confidenceBand(f.confidence);
    const valueLines    = wrapText(f.value || (f.confidence === 0 ? '(not found)' : '—'), 38).slice(0, 3);
    const originalLines = wrapText(f.originalValue ?? '', 26).slice(0, 3);
    const fieldLines    = wrapText(f.matchedAnchor || f.key, 24).slice(0, 2);
    const rowH = Math.max(
      rowMinH,
      12 + (Math.max(valueLines.length, originalLines.length, fieldLines.length) - 1) * 10,
    );

    // Page break — re-draw the table header on the next page so a row
    // never appears with no column labels above it.
    if (y + rowH > H - 110) {
      doc.addPage();
      y = 36;
      drawHeader();
      doc.setFont('Arial', 'normal');
      doc.setFontSize(8);
    }

    // Confidence band background — same semantic colors the reviewer
    // UI uses on-screen.
    if (band.bg !== ZERO_BG) {
      doc.setFillColor(band.bg);
      doc.rect(M, y, tableW, rowH, 'F');
    } else if (i % 2 === 1) {
      doc.setFillColor(ROW_ALT);
      doc.rect(M, y, tableW, rowH, 'F');
    }

    let x = M + 6;
    doc.setTextColor(TEXT_DARK);
    // Field
    for (let li = 0; li < fieldLines.length; li++) {
      doc.text(fieldLines[li], x, y + 11 + li * 10);
    }
    // Show the canonical key under the human label for traceability.
    if (f.matchedAnchor && f.matchedAnchor !== f.key) {
      doc.setTextColor(TEXT_MUTED);
      doc.setFontSize(7);
      doc.text(f.key, x, y + rowH - 4);
      doc.setFontSize(8);
      doc.setTextColor(TEXT_DARK);
    }
    x += cols[0].width;
    // Final value
    for (let li = 0; li < valueLines.length; li++) {
      doc.text(valueLines[li], x, y + 11 + li * 10);
    }
    x += cols[1].width;
    // OCR original — show only when it differs from the final value (the
    // clerk edited it). Greyed so the diff is visible at a glance.
    doc.setTextColor(TEXT_MUTED);
    const showOriginal = (f.originalValue ?? f.value) !== f.value;
    if (showOriginal && originalLines.length > 0) {
      for (let li = 0; li < originalLines.length; li++) {
        doc.text(originalLines[li], x, y + 11 + li * 10);
      }
    } else {
      doc.text('(unchanged)', x, y + 11);
    }
    doc.setTextColor(TEXT_DARK);
    x += cols[2].width;
    // Confidence
    doc.text(`${band.pct}  ${band.label}`, x, y + 11);

    y += rowH;
  }

  // ── Raw-text preview ───────────────────────────────────────────
  if (rawTextPreview && rawTextPreview.trim()) {
    y += 10;
    if (y > H - 140) { doc.addPage(); y = 36; }
    doc.setFont('Arial', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    doc.text(`Raw text preview (${rawTextPreview.length.toLocaleString()} chars)`, M, y);
    y += 12;
    doc.setDrawColor(BORDER);
    doc.rect(M, y, W - 2 * M, 0);
    doc.setFont('Arial', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(TEXT_MUTED);
    // Cap at ~40 lines to keep the report a sensible length; the
    // database (or live page) still holds the full text.
    const previewLines = wrapText(rawTextPreview, 95).slice(0, 40);
    for (const line of previewLines) {
      if (y > H - 60) { doc.addPage(); y = 36; }
      doc.text(line, M + 4, y + 8);
      y += 9;
    }
    if (rawTextPreview.length > 0 && wrapText(rawTextPreview, 95).length > 40) {
      doc.setTextColor(TEXT_MUTED);
      doc.text('… (preview truncated)', M + 4, y + 10);
      y += 12;
    }
  }

  // ── Page footers + signature block on the last page ────────────
  const pageCountAll = doc.getNumberOfPages();
  for (let p = 1; p <= pageCountAll; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(TEXT_MUTED);
    doc.text(`Page ${p} of ${pageCountAll}`, W - M, H - 16, { align: 'right' });
    doc.text('RMPG Flex — confidential law-enforcement record', M, H - 16);
  }

  // Signature block — last page, above the footer.
  doc.setPage(pageCountAll);
  if (y + 60 > H - 30) {
    doc.addPage();
    y = 36;
  } else {
    y = Math.max(y + 24, H - 80);
  }
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  doc.line(M, y, M + 220, y);
  doc.line(W - M - 220, y, W - M, y);
  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Reviewing clerk (signature / date)', M, y + 12);
  doc.text('Records supervisor (signature / date)', W - M - 220, y + 12);

  // Refresh page footer for any newly added signature page.
  const finalPageCount = doc.getNumberOfPages();
  if (finalPageCount !== pageCountAll) {
    doc.setPage(finalPageCount);
    doc.setFontSize(7);
    doc.setTextColor(TEXT_MUTED);
    doc.text(`Page ${finalPageCount} of ${finalPageCount}`, W - M, H - 16, { align: 'right' });
    doc.text('RMPG Flex — confidential law-enforcement record', M, H - 16);
  }

  return doc;
}
