// ═══════════════════════════════════════════════════════════════
// Tasks — supervisor task-list PDF generator.
// ───────────────────────────────────────────────────────────────
// The Tasks page (`/tasks`, Page 47 of the full-app frontend pass)
// shipped without an export surface, so a supervisor couldn't hand
// a roll-call printout of "all open tasks for the squad" to a
// shift sergeant, and an admin couldn't attach a snapshot of the
// task queue to a discovery package or an internal-affairs review.
//
// Output is intentionally lower-evidentiary than auditLogPdf — the
// task table is mutable (status flips, due-date edits, assignee
// reassignments) so there's no append-only tamper-evidence claim
// to make. What the PDF *does* guarantee is reproducibility:
//   • Filter-snapshot block documents which slice was exported.
//   • Generated-at timestamp anchors the data to a moment in time.
//   • Signature block for the exporting supervisor + reviewer.
//
// Visual contract follows the same Arial + RMPG-gold banner used by
// auditLogPdf / bodycamVideoCustodyPdf / fiCardPdf so a court packet
// assembled from multiple surfaces looks consistent.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { describeDueDate } from './taskDueCountdown';
import { toDisplayLabel } from './formatters';
import { drawNavyBanner } from './pdfStandaloneHeader';

const RMPG_GOLD = '#d4a017';
const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const OVERDUE_BG = '#fde8e8';
const OVERDUE_TEXT = '#991b1b';

const MT_TZ = 'America/Denver';

export interface TaskRowForPdf {
  id: number;
  task_title: string;
  priority?: string | null;
  status?: string | null;
  assigned_to_name?: string | null;
  assigned_by_name?: string | null;
  due_date?: string | null;
  linked_entity_type?: string | null;
  linked_entity_id?: number | string | null;
  description?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
}

export interface TaskPdfFilters {
  status?: string;
  priority?: string;
  assignedTo?: string;
  assignedToName?: string;
  entityType?: string;
  overdue?: boolean;
}

export interface TaskPdfInput {
  tasks: TaskRowForPdf[];
  /** Filter snapshot the operator was looking at when they hit Print —
   *  rendered verbatim so the resulting PDF cannot be mistaken for a
   *  full-table export. */
  filters?: TaskPdfFilters;
  /** Server-side total matching the filters, when known (the page may
   *  paginate the on-screen view). */
  totalMatching?: number;
  /** Optional — the user who exported (for the signature block). */
  exportedBy?: string;
}

// ── Public helpers (unit-tested) ─────────────────────────────────

/** Format an ISO/SQLite timestamp as "2026-06-22 14:23 MT". */
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
 *  Preserves explicit `\n` paragraph breaks. Same algorithm as
 *  auditLogPdf.wrapText — kept local rather than imported so the two
 *  PDFs can evolve independently. */
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

/** Compose a human-readable summary of the active filters. Returns
 *  "Unfiltered (all tasks)" when every field is empty. Also used as
 *  part of the suggested filename so a stack of exports doesn't end
 *  up with five identical names. */
export function describeFilters(f?: TaskPdfFilters): string {
  if (!f) return 'Unfiltered (all tasks)';
  const bits: string[] = [];
  if (f.status) bits.push(`status=${f.status}`);
  if (f.priority) bits.push(`priority=${f.priority}`);
  // Prefer the resolved officer name over the raw user id when both are
  // available — the supervisor reading the PDF cares about the person,
  // not the database key.
  if (f.assignedToName) bits.push(`assignee=${f.assignedToName}`);
  else if (f.assignedTo) bits.push(`assignee_id=${f.assignedTo}`);
  if (f.entityType) bits.push(`linked=${f.entityType}`);
  if (f.overdue) bits.push('overdue=only');
  return bits.length === 0 ? 'Unfiltered (all tasks)' : bits.join(', ');
}

// ── PDF body ────────────────────────────────────────────────────

export function generateTasksPdf(input: TaskPdfInput): jsPDF {
  const { tasks, filters, totalMatching, exportedBy } = input;
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  y = drawNavyBanner(doc, {
    title: 'TASK ASSIGNMENTS — SUPERVISOR REPORT',
    subtitle: 'Task Management',
    rightLine1: `Generated ${fmtTimestamp(new Date().toISOString())}`,
  });

  // Filter snapshot — describes the exact slice this PDF covers.
  doc.setFont('Arial', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_DARK);
  doc.text('Filter snapshot:', M, y);
  doc.setFont('Arial', 'normal');
  const summaryLines = wrapText(describeFilters(filters), 120);
  let summaryY = y;
  for (const line of summaryLines) {
    doc.text(line, M + 88, summaryY);
    summaryY += 12;
  }
  y = summaryY + 4;

  if (typeof totalMatching === 'number' && totalMatching !== tasks.length) {
    doc.setTextColor(TEXT_MUTED);
    doc.setFontSize(8);
    doc.text(
      `Showing ${tasks.length} of ${totalMatching} matching tasks (the page paginates the view).`,
      M, y,
    );
    y += 12;
  }
  y += 6;

  // ── Table ──────────────────────────────────────────────────────
  // Columns: ID | Title | Priority | Status | Assignee | Due | Linked
  // Widths chosen for landscape letter (792 pt) minus 2*36 margin.
  type Col = { key: keyof TaskRowForPdf | 'due_label' | 'linked'; label: string; width: number };
  const cols: Col[] = [
    { key: 'id',                  label: 'ID',       width: 36  },
    { key: 'task_title',          label: 'Task',     width: 220 },
    { key: 'priority',            label: 'Priority', width: 60  },
    { key: 'status',              label: 'Status',   width: 70  },
    { key: 'assigned_to_name',    label: 'Assignee', width: 110 },
    { key: 'due_label',           label: 'Due',      width: 90  },
    { key: 'linked',              label: 'Linked',   width: 110 },
  ];

  const headerH = 16;
  const rowMinH = 18;

  function drawHeader() {
    doc.setFillColor(RMPG_GOLD);
    doc.rect(M, y, W - 2 * M, headerH, 'F');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    let x = M + 4;
    for (const c of cols) {
      doc.text(c.label, x, y + 11);
      x += c.width;
    }
    y += headerH;
  }
  drawHeader();

  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);

  if (tasks.length === 0) {
    doc.setTextColor(TEXT_MUTED);
    doc.text('No tasks match the supplied filters.', M + 6, y + 14);
    y += rowMinH;
  }

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const due = describeDueDate(t.due_date ?? null);
    const linkedText = t.linked_entity_type
      ? `${t.linked_entity_type}${t.linked_entity_id != null ? `#${t.linked_entity_id}` : ''}`
      : '—';
    // Wrap the title so long task names don't get sliced off — cap at
    // 2 lines so rows stay scannable on a printed page.
    const titleLines = wrapText(t.task_title || '—', 38).slice(0, 2);
    const rowH = Math.max(rowMinH, 12 + (titleLines.length - 1) * 10);

    // Page break — re-draw the table header on the next page so a row
    // never appears with no column labels above it.
    if (y + rowH > H - 90) {
      doc.addPage();
      y = 36;
      drawHeader();
      doc.setFont('Arial', 'normal');
      doc.setFontSize(8);
    }

    // Zebra striping + overdue accent.
    if (due.tone === 'overdue') {
      doc.setFillColor(OVERDUE_BG);
      doc.rect(M, y, W - 2 * M, rowH, 'F');
    } else if (i % 2 === 1) {
      doc.setFillColor(ROW_ALT);
      doc.rect(M, y, W - 2 * M, rowH, 'F');
    }

    let x = M + 4;
    doc.setTextColor(TEXT_DARK);
    // ID
    doc.text(String(t.id), x, y + 11); x += cols[0].width;
    // Title (may wrap)
    for (let li = 0; li < titleLines.length; li++) {
      doc.text(titleLines[li], x, y + 11 + li * 10);
    }
    x += cols[1].width;
    // Priority — uppercase for scannability
    doc.text((t.priority || '—').toUpperCase(), x, y + 11); x += cols[2].width;
    // Status
    doc.text(toDisplayLabel(t.status || '—'), x, y + 11); x += cols[3].width;
    // Assignee
    doc.text(t.assigned_to_name || 'Unassigned', x, y + 11); x += cols[4].width;
    // Due — colour the overdue label
    if (due.tone === 'overdue') doc.setTextColor(OVERDUE_TEXT);
    doc.text(due.label, x, y + 11);
    if (due.tone === 'overdue') doc.setTextColor(TEXT_DARK);
    x += cols[5].width;
    // Linked
    doc.text(linkedText, x, y + 11);

    y += rowH;
  }

  // ── Page footers + signature block on the last page ────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(TEXT_MUTED);
    doc.text(`Page ${p} of ${pageCount}`, W - M, H - 16, { align: 'right' });
    doc.text('RMPG Flex — confidential law-enforcement record', M, H - 16);
  }

  // Signature block — last page, above the footer.
  doc.setPage(pageCount);
  if (y + 60 > H - 30) {
    doc.addPage();
    y = 36;
  } else {
    y = Math.max(y + 20, H - 80);
  }
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  doc.line(M, y, M + 220, y);
  doc.line(W - M - 220, y, W - M, y);
  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Exporting supervisor (signature / date)', M, y + 12);
  doc.text('Reviewing supervisor (signature / date)', W - M - 220, y + 12);

  // Refresh page footer for any newly added signature page.
  const finalPageCount = doc.getNumberOfPages();
  if (finalPageCount !== pageCount) {
    doc.setPage(finalPageCount);
    doc.setFontSize(7);
    doc.setTextColor(TEXT_MUTED);
    doc.text(`Page ${finalPageCount} of ${finalPageCount}`, W - M, H - 16, { align: 'right' });
    doc.text('RMPG Flex — confidential law-enforcement record', M, H - 16);
  }

  return doc;
}
