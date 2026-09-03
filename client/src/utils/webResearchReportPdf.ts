// ═══════════════════════════════════════════════════════════════
// Web Research — investigator hand-off / court-prep PDF.
//
// Renders one operator's saved web-research corpus (a list of saved
// SavedResult rows for an active filter) into a court-ready letter
// PDF: gold banner, query context block, per-result entries with
// title / URL / source description / operator notes / scraped
// excerpt, and an officer attribution + datestamp footer with the
// same chain-of-custody language the other audit-series PDFs use
// (skipTracerReportPdf, fiCardPdf, auditLogPdf, etc.).
//
// Web-research results are investigative leads pulled from public
// internet sources — they are NOT adjudicated facts. The footer
// makes that explicit so an officer who hands the printout to a
// prosecutor or attaches it to a case file cannot accidentally
// pass off an OSINT lead as a verified record.
//
// Pure (no DOM, no apiFetch) so it is easy to unit-test if a
// regression surfaces. The page-side `openWebResearchReportPdf`
// wrapper opens the result in a new tab.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { openPdfBlob } from './openPdfDocument';
import { drawNavyBanner } from './pdfStandaloneHeader';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';

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

export interface WebResearchResultForPdf {
  id: number;
  query: string;
  title: string;
  url: string;
  description: string;
  type: 'search' | 'scrape' | string;
  notes: string | null;
  linked_entity_type: string | null;
  linked_entity_id: number | null;
  scraped_content: string | null;
  created_at: string;
}

export interface WebResearchPdfContext {
  /** Filter the operator had active when they exported. Goes on the
   *  cover so a reviewer can tell which slice of the corpus they
   *  are reading. */
  filter: 'all' | 'incident' | 'person' | 'case' | 'unlinked' | string;
  /** Optional officer-name attribution for the cover + footer. */
  officerName?: string;
  /** Optional badge number for the footer. */
  badgeNumber?: string;
  /** Optional case/incident number this research is being filed under. */
  caseNumber?: string;
}

const FILTER_LABEL: Record<string, string> = {
  all: 'All Saved Results',
  incident: 'Linked to Incidents',
  person: 'Linked to Persons',
  case: 'Linked to Cases',
  unlinked: 'Unlinked',
};

/** Build the PDF for a set of saved web-research rows. Returns the
 *  jsPDF instance so the caller decides whether to open it, save
 *  it, or print it. */
export function generateWebResearchReportPdf(
  results: WebResearchResultForPdf[],
  ctx: WebResearchPdfContext,
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  const filterLabel = FILTER_LABEL[ctx.filter] || ctx.filter;

  y = drawNavyBanner(doc, {
    title: `WEB RESEARCH REPORT — ${filterLabel.toUpperCase()}`,
    subtitle: 'Investigations / OSINT',
    rightLine1: `Generated ${fmtDateTime(new Date())}`,
  });

  // ── Context block ──
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('EXPORT CONTEXT', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  const ctxFields: Array<[string, string]> = [
    ['Filter', filterLabel],
    ['Result Count', String(results.length)],
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

  // ── Helpers ──
  const ensureRoom = (need: number) => {
    if (y + need > H - 80) { doc.addPage(); y = 48; }
  };

  // ── Empty corpus ──
  if (results.length === 0) {
    ensureRoom(60);
    doc.setFont('Arial', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_MUTED);
    doc.text('No saved research results matched the active filter at the time of export.', M, y);
    y += 14;
  }

  // ── Per-result block ──
  let idx = 0;
  for (const r of results) {
    idx += 1;
    ensureRoom(60);

    // Numbered title bar (alternating row tint) — keeps a 30-row
    // export visually scannable when stapled.
    const titleBgY = y - 10;
    const titleBgH = 18;
    if (idx % 2 === 0) {
      doc.setFillColor(ROW_ALT);
      doc.rect(M, titleBgY, W - 2 * M, titleBgH, 'F');
    }
    doc.setFont('Arial', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(TEXT_DARK);
    const titleText = `${idx}. ${r.title || 'Untitled'}`;
    const titleWrapped = doc.splitTextToSize(titleText, W - 2 * M - 8);
    doc.text(titleWrapped[0] ?? titleText, M + 4, y);
    y += 14;

    // Source URL
    doc.setFont('Arial', 'normal');
    doc.setFontSize(8);
    doc.setTextColor('#1d4ed8');
    const urlWrapped = doc.splitTextToSize(r.url, W - 2 * M - 8);
    for (const line of urlWrapped) {
      ensureRoom(10);
      doc.text(line, M + 4, y);
      y += 10;
    }

    // Metadata strip (type · query · linked entity · saved-at)
    doc.setFont('Arial', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(TEXT_MUTED);
    const metaParts: string[] = [];
    metaParts.push(`Type: ${(r.type || 'search').toUpperCase()}`);
    if (r.query) metaParts.push(`Query: "${r.query}"`);
    if (r.linked_entity_type && r.linked_entity_id != null) {
      metaParts.push(`Linked: ${r.linked_entity_type} #${r.linked_entity_id}`);
    }
    metaParts.push(`Saved: ${fmtDateTime(r.created_at)}`);
    const metaLine = metaParts.join('  ·  ');
    const metaWrapped = doc.splitTextToSize(metaLine, W - 2 * M - 8);
    for (const line of metaWrapped) {
      ensureRoom(10);
      doc.text(line, M + 4, y);
      y += 10;
    }
    y += 2;

    // Source description (from search engine)
    if (r.description && r.description.trim()) {
      ensureRoom(14);
      doc.setFont('Arial', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(TEXT_DARK);
      const descWrapped = doc.splitTextToSize(r.description.trim(), W - 2 * M - 8);
      for (const line of descWrapped) {
        ensureRoom(11);
        doc.text(line, M + 4, y);
        y += 11;
      }
      y += 2;
    }

    // Operator notes — clearly labeled, distinct from source content
    if (r.notes && r.notes.trim()) {
      ensureRoom(20);
      doc.setFont('Arial', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(TEXT_MUTED);
      doc.text('OPERATOR NOTES', M + 4, y);
      y += 10;
      doc.setFont('Arial', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(TEXT_DARK);
      const notesWrapped = doc.splitTextToSize(r.notes.trim(), W - 2 * M - 16);
      for (const line of notesWrapped) {
        ensureRoom(11);
        doc.text(line, M + 12, y);
        y += 11;
      }
      y += 2;
    }

    // Scraped excerpt — bounded to keep one result on a couple of
    // pages max even when the scrape returned a 200KB markdown dump.
    if (r.scraped_content && r.scraped_content.trim()) {
      const MAX_CHARS = 2000;
      const excerpt = r.scraped_content.length > MAX_CHARS
        ? r.scraped_content.slice(0, MAX_CHARS) + '\n\n[Excerpt truncated — see saved record for full content.]'
        : r.scraped_content;

      ensureRoom(20);
      doc.setFont('Arial', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(TEXT_MUTED);
      doc.text('SCRAPED CONTENT EXCERPT', M + 4, y);
      y += 10;
      doc.setFont('Courier', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(TEXT_DARK);
      const excerptWrapped = doc.splitTextToSize(excerpt, W - 2 * M - 16);
      for (const line of excerptWrapped) {
        ensureRoom(10);
        doc.text(line, M + 12, y);
        y += 10;
      }
      doc.setFont('Arial', 'normal');
      y += 2;
    }

    // Separator between rows
    ensureRoom(10);
    doc.setDrawColor(BORDER);
    doc.setLineWidth(0.25);
    doc.line(M, y, W - M, y);
    y += 10;
  }

  // ── Audit footer ──
  if (y > H - 120) { doc.addPage(); y = 48; }
  y = H - 80;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text(
    'This report aggregates web-research entries saved by RMPG Flex operators at the time of generation. ' +
    'OSINT results are investigative leads pulled from public internet sources — they are NOT adjudicated ' +
    'facts. Corroborate via independent verification before action; chain-of-custody for any cited URL is ' +
    'the originating site, not RMPG Flex.',
    M, y, { maxWidth: W - 2 * M },
  );
  y = H - 18;
  doc.setFontSize(7);
  const footRight = ctx.officerName
    ? `${ctx.officerName}${ctx.badgeNumber ? ` #${ctx.badgeNumber}` : ''}  ·  ${fmtDateTime(new Date())}`
    : fmtDateTime(new Date());
  doc.text('RMPG Flex  ·  Web Research Report', M, y);
  doc.text(footRight, W - M, y, { align: 'right' });

  return doc;
}

/** Open the generated PDF in a new browser tab. */
export function openWebResearchReportPdf(
  results: WebResearchResultForPdf[],
  ctx: WebResearchPdfContext,
): void {
  const doc = generateWebResearchReportPdf(results, ctx);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Web Research Report');
}
