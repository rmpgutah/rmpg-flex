// ═══════════════════════════════════════════════════════════════
// Knowledge Base — search-result audit / hand-off PDF.
//
// The Knowledge Base page is the system-wide one-search-box destination.
// Operators routinely run a name / plate / call # query, copy a screenshot
// into a case folder, and call it good. That screenshot is not a record:
// it carries no datestamp, no officer attribution, and no trail back to
// the system that returned the rows. This generator turns the same on-
// screen result list into a court-filable artifact — gold banner, query
// strap, datestamped officer footer, type-grouped result tables. It
// matches the Arial + RMPG-gold visual contract used by darPdf /
// skipTracerReportPdf / shiftReportPdf / evidenceItemPdf so a multi-
// surface court binder keeps a consistent look.
//
// Pure-client (no DOM, no apiFetch) — easy to unit test. The page-side
// `openKnowledgeBaseSearchPdf` wrapper builds the input and opens the
// resulting blob in a new tab.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import type { KbResult } from './knowledgeBase';
import { kbTypeLabel } from './knowledgeBase';
import { drawNavyBanner } from './pdfStandaloneHeader';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';

const MT_TZ = 'America/Denver';

/** "Mon Jun 22, 2026 14:35 MT" */
function fmtNow(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, weekday: 'short', month: 'short', day: 'numeric',
      year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d) + ' MT';
  } catch {
    return d.toISOString();
  }
}

/** Truncate to fit a column. Public for testing. */
export function ellipsize(s: string | undefined, max: number): string {
  const v = (s ?? '').toString();
  return v.length <= max ? v : v.slice(0, Math.max(1, max - 1)) + '…';
}

/** Group results by type, preserving the rank order they came in. Public for testing. */
export function groupByType(results: readonly KbResult[]): Array<[string, KbResult[]]> {
  const groups: Array<[string, KbResult[]]> = [];
  for (const r of results) {
    const g = groups.find(([t]) => t === r.type);
    if (g) g[1].push(r); else groups.push([r.type, [r]]);
  }
  return groups;
}

export interface KnowledgeBaseSearchPdfInput {
  /** What the operator typed into the search box. Goes on the cover strap. */
  query: string;
  /** The ranked, normalized result list as currently shown on the page. */
  results: readonly KbResult[];
  /** Optional type filter the operator had active when they exported. */
  activeTypeFilter?: string | null;
  /** Operator name for the footer attribution. */
  officerName?: string;
  /** Badge number for the footer attribution. */
  badgeNumber?: string;
  /** Optional case / incident number this search was filed under. */
  caseNumber?: string;
  /** Override the now-clock (for deterministic tests). */
  generatedAt?: Date;
}

/** Build the PDF. Layout: 8.5×11 portrait. */
export function generateKnowledgeBaseSearchPdf(input: KnowledgeBaseSearchPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  const generatedStamp = fmtNow(input.generatedAt ?? new Date());

  y = drawNavyBanner(doc, {
    title: 'KNOWLEDGE BASE — SEARCH RESULTS',
    subtitle: 'System-Wide Records Search',
    rightLine1: generatedStamp,
  });

  // Query strap (the canonical "what the operator asked" record)
  const queryText = (input.query || '').trim() || '(empty)';
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.setFont('Arial', 'bold');
  doc.text('Query:', M, y);
  doc.setFont('Arial', 'normal');
  doc.text(ellipsize(queryText, 110), M + 44, y);
  y += 14;

  const filterText = input.activeTypeFilter
    ? kbTypeLabel(input.activeTypeFilter)
    : 'All record types';
  doc.setFont('Arial', 'bold');
  doc.text('Filter:', M, y);
  doc.setFont('Arial', 'normal');
  doc.text(filterText, M + 44, y);

  doc.setFont('Arial', 'bold');
  doc.text('Total hits:', M + 280, y);
  doc.setFont('Arial', 'normal');
  doc.text(String(input.results.length), M + 340, y);
  y += 14;

  if (input.caseNumber) {
    doc.setFont('Arial', 'bold');
    doc.text('Case:', M, y);
    doc.setFont('Arial', 'normal');
    doc.text(input.caseNumber, M + 44, y);
    y += 14;
  }
  y += 6;

  // Results — grouped by type. Each group renders a small table.
  if (input.results.length === 0) {
    doc.setFontSize(11);
    doc.setTextColor(TEXT_MUTED);
    doc.setFont('Arial', 'italic');
    doc.text(`No records matched "${ellipsize(queryText, 80)}".`, M, y + 10);
  } else {
    const groups = groupByType(input.results);

    const COL_LABEL_X = M + 4;
    const COL_TITLE_X = M + 150;
    const COL_SUB_X = M + 320;
    const ROW_H = 13;
    const HEADER_H = 14;
    const GROUP_GAP = 10;

    for (const [type, rows] of groups) {
      // Page break if the group header + at least one row won't fit
      if (y + 40 > H - 60) {
        doc.addPage();
        y = 36;
      }

      // Group header bar
      doc.setFillColor(230, 230, 230);
      doc.rect(M, y, W - 2 * M, HEADER_H, 'F');
      doc.setDrawColor(BORDER);
      doc.setLineWidth(0.4);
      doc.rect(M, y, W - 2 * M, HEADER_H);
      doc.setFont('Arial', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(TEXT_DARK);
      doc.text(kbTypeLabel(type).toUpperCase(), M + 4, y + 10);
      doc.text(`${rows.length} hit${rows.length === 1 ? '' : 's'}`, W - M - 4, y + 10, { align: 'right' });
      y += HEADER_H;

      // Column header
      doc.setFillColor(245, 245, 245);
      doc.rect(M, y, W - 2 * M, ROW_H, 'F');
      doc.rect(M, y, W - 2 * M, ROW_H);
      doc.setFont('Arial', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(TEXT_MUTED);
      doc.text('IDENTIFIER', COL_LABEL_X, y + 9);
      doc.text('DESCRIPTION', COL_TITLE_X, y + 9);
      doc.text('DETAIL', COL_SUB_X, y + 9);
      y += ROW_H;

      doc.setFont('Arial', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(TEXT_DARK);

      let alt = false;
      for (const r of rows) {
        if (y + ROW_H > H - 60) {
          doc.addPage();
          y = 36;
        }
        if (alt) {
          doc.setFillColor(ROW_ALT);
          doc.rect(M, y, W - 2 * M, ROW_H, 'F');
        }
        doc.setDrawColor(BORDER);
        doc.setLineWidth(0.2);
        doc.line(M, y + ROW_H, W - M, y + ROW_H);

        doc.text(ellipsize(r.label, 28), COL_LABEL_X, y + 9);
        doc.text(ellipsize(r.title, 30), COL_TITLE_X, y + 9);
        doc.text(ellipsize(r.subtitle, 38), COL_SUB_X, y + 9);
        y += ROW_H;
        alt = !alt;
      }
      y += GROUP_GAP;
    }
  }

  // Footer — every page gets it
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(TEXT_MUTED);
    doc.setFont('Arial', 'normal');
    const officer = input.officerName || 'Unknown Officer';
    const badge = input.badgeNumber ? `Badge ${input.badgeNumber}` : '';
    const left = badge ? `${officer}  ·  ${badge}` : officer;
    doc.text(left, M, H - 24);
    doc.text(`Generated ${generatedStamp}`, W - M, H - 24, { align: 'right' });
    doc.text(`Page ${p} of ${pageCount}`, W / 2, H - 24, { align: 'center' });
  }

  return doc;
}
