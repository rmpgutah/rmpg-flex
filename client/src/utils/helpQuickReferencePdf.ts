// ============================================================
// RMPG Flex — Help Quick Reference Card PDF
//
// Produces a tear-off two-page quick-reference card with the
// most-used keyboard shortcuts, dispatch priority + status
// codes, and CAD command line cheat-sheet. Designed to be
// printed on US Letter and kept at the dispatcher's console.
//
// This is a smaller companion to dispatchGuidePdfGenerator.ts —
// the dispatch guide is a long-form training manual; this card
// is just the lookup table. Both are launched from HelpPage.
// ============================================================

import jsPDF from 'jspdf';
import { openPdfDocument } from './openPdfDocument';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

interface PriorityRow {
  level: string;
  label: string;
  desc: string;
}

interface UnitStatusRow {
  code: string;
  label: string;
  desc: string;
}

interface CommandRow {
  cmd: string;
  desc: string;
}

const PAGE = { W: 612, H: 792, MARGIN: 40 }; // US Letter @ 72dpi

const COLOR = {
  BLACK: '#000000',
  INK: '#1a1a1a',
  MUTED: '#666666',
  RULE: '#cccccc',
  CARD_BG: '#f7f7f7',
  HEADER_BG: '#2a2a2a',
  HEADER_FG: '#ffffff',
};

interface Ctx {
  doc: jsPDF;
  y: number;
  page: number;
}

function header(ctx: Ctx, title: string): void {
  const d = ctx.doc;
  d.setFillColor(COLOR.HEADER_BG);
  d.rect(0, 0, PAGE.W, 56, 'F');
  d.setFont('helvetica', 'bold');
  d.setFontSize(16);
  d.setTextColor(COLOR.HEADER_FG);
  d.text('RMPG FLEX', PAGE.MARGIN, 24);
  d.setFontSize(11);
  d.setFont('helvetica', 'normal');
  d.text(title, PAGE.MARGIN, 42);
  d.setFontSize(8);
  d.text('CONFIDENTIAL — AUTHORIZED USE ONLY', PAGE.W - PAGE.MARGIN, 42, { align: 'right' });
  d.text(new Date().toISOString().slice(0, 10), PAGE.W - PAGE.MARGIN, 24, { align: 'right' });
  ctx.y = 72;
}

function footer(ctx: Ctx, totalPages: number): void {
  const d = ctx.doc;
  d.setFont('helvetica', 'normal');
  d.setFontSize(7);
  d.setTextColor(COLOR.MUTED);
  d.text(
    `Page ${ctx.page} of ${totalPages}  ·  Quick Reference Card  ·  Generated ${new Date().toISOString().slice(0, 10)}`,
    PAGE.W / 2,
    PAGE.H - 20,
    { align: 'center' },
  );
}

function sectionTitle(ctx: Ctx, text: string): void {
  const d = ctx.doc;
  d.setFont('helvetica', 'bold');
  d.setFontSize(10);
  d.setTextColor(COLOR.BLACK);
  d.text(text, PAGE.MARGIN, ctx.y);
  d.setDrawColor(COLOR.BLACK);
  d.setLineWidth(0.8);
  d.line(PAGE.MARGIN, ctx.y + 2, PAGE.W - PAGE.MARGIN, ctx.y + 2);
  ctx.y += 14;
}

function shortcutColumn(
  ctx: Ctx,
  group: ShortcutGroup,
  x: number,
  colWidth: number,
): number {
  const d = ctx.doc;
  d.setFont('helvetica', 'bold');
  d.setFontSize(9);
  d.setTextColor(COLOR.BLACK);
  d.text(group.title, x, ctx.y);
  d.setDrawColor(COLOR.RULE);
  d.setLineWidth(0.4);
  d.line(x, ctx.y + 2, x + colWidth, ctx.y + 2);
  let y = ctx.y + 14;
  d.setFont('helvetica', 'normal');
  d.setFontSize(8);
  d.setTextColor(COLOR.INK);
  for (const s of group.shortcuts) {
    const keysText = s.keys.join('+');
    d.setFont('helvetica', 'bold');
    d.text(keysText, x, y);
    d.setFont('helvetica', 'normal');
    d.setTextColor(COLOR.INK);
    const descLines = d.splitTextToSize(s.description, colWidth - 80) as string[];
    d.text(descLines[0] ?? '', x + 80, y);
    y += 11;
    for (let i = 1; i < descLines.length; i++) {
      d.text(descLines[i], x + 80, y);
      y += 11;
    }
  }
  return y;
}

function priorityTable(ctx: Ctx, rows: PriorityRow[]): void {
  const d = ctx.doc;
  const x = PAGE.MARGIN;
  const w = PAGE.W - PAGE.MARGIN * 2;
  // Header
  d.setFillColor(COLOR.CARD_BG);
  d.rect(x, ctx.y - 9, w, 12, 'F');
  d.setFont('helvetica', 'bold');
  d.setFontSize(8);
  d.setTextColor(COLOR.BLACK);
  d.text('LEVEL', x + 4, ctx.y);
  d.text('CLASSIFICATION', x + 50, ctx.y);
  d.text('DESCRIPTION', x + 170, ctx.y);
  ctx.y += 6;
  d.setDrawColor(COLOR.RULE);
  d.line(x, ctx.y, x + w, ctx.y);
  ctx.y += 8;
  d.setFont('helvetica', 'normal');
  for (const r of rows) {
    d.setFont('helvetica', 'bold');
    d.text(r.level, x + 4, ctx.y);
    d.text(r.label, x + 50, ctx.y);
    d.setFont('helvetica', 'normal');
    d.setTextColor(COLOR.INK);
    const descLines = d.splitTextToSize(r.desc, w - 174) as string[];
    d.text(descLines[0] ?? '', x + 170, ctx.y);
    ctx.y += 11;
    for (let i = 1; i < descLines.length; i++) {
      d.text(descLines[i], x + 170, ctx.y);
      ctx.y += 11;
    }
    d.setTextColor(COLOR.BLACK);
  }
  ctx.y += 4;
}

function statusTable(ctx: Ctx, rows: UnitStatusRow[]): void {
  const d = ctx.doc;
  const x = PAGE.MARGIN;
  const w = PAGE.W - PAGE.MARGIN * 2;
  d.setFillColor(COLOR.CARD_BG);
  d.rect(x, ctx.y - 9, w, 12, 'F');
  d.setFont('helvetica', 'bold');
  d.setFontSize(8);
  d.setTextColor(COLOR.BLACK);
  d.text('CODE', x + 4, ctx.y);
  d.text('STATUS', x + 50, ctx.y);
  d.text('MEANING', x + 170, ctx.y);
  ctx.y += 6;
  d.setDrawColor(COLOR.RULE);
  d.line(x, ctx.y, x + w, ctx.y);
  ctx.y += 8;
  for (const r of rows) {
    d.setFont('helvetica', 'bold');
    d.text(r.code, x + 4, ctx.y);
    d.text(r.label, x + 50, ctx.y);
    d.setFont('helvetica', 'normal');
    const descLines = d.splitTextToSize(r.desc, w - 174) as string[];
    d.text(descLines[0] ?? '', x + 170, ctx.y);
    ctx.y += 11;
    for (let i = 1; i < descLines.length; i++) {
      d.text(descLines[i], x + 170, ctx.y);
      ctx.y += 11;
    }
  }
  ctx.y += 4;
}

function commandTable(ctx: Ctx, rows: CommandRow[]): void {
  const d = ctx.doc;
  const x = PAGE.MARGIN;
  const w = PAGE.W - PAGE.MARGIN * 2;
  d.setFillColor(COLOR.CARD_BG);
  d.rect(x, ctx.y - 9, w, 12, 'F');
  d.setFont('helvetica', 'bold');
  d.setFontSize(8);
  d.setTextColor(COLOR.BLACK);
  d.text('COMMAND', x + 4, ctx.y);
  d.text('PURPOSE', x + 200, ctx.y);
  ctx.y += 6;
  d.setDrawColor(COLOR.RULE);
  d.line(x, ctx.y, x + w, ctx.y);
  ctx.y += 8;
  for (const r of rows) {
    d.setFont('courier', 'normal');
    d.setFontSize(8);
    d.text(r.cmd, x + 4, ctx.y);
    d.setFont('helvetica', 'normal');
    const descLines = d.splitTextToSize(r.desc, w - 204) as string[];
    d.text(descLines[0] ?? '', x + 200, ctx.y);
    ctx.y += 11;
    for (let i = 1; i < descLines.length; i++) {
      d.text(descLines[i], x + 200, ctx.y);
      ctx.y += 11;
    }
  }
}

export interface HelpQuickReferenceInput {
  shortcutGroups: ShortcutGroup[];
  priorities: PriorityRow[];
  unitStatuses: UnitStatusRow[];
  cadCommands: CommandRow[];
  appVersion: string;
}

/** Build the quick-reference PDF document (jsPDF). Returns the doc, doesn't save it. */
export function buildHelpQuickReferencePdf(input: HelpQuickReferenceInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const ctx: Ctx = { doc, y: 0, page: 1 };

  // ── Page 1: Shortcuts ──────────────────────────────────
  header(ctx, `Quick Reference Card — v${input.appVersion}`);
  sectionTitle(ctx, 'Keyboard Shortcuts');

  const colW = (PAGE.W - PAGE.MARGIN * 2 - 20) / 2;
  const leftX = PAGE.MARGIN;
  const rightX = PAGE.MARGIN + colW + 20;

  const halfCount = Math.ceil(input.shortcutGroups.length / 2);
  const leftGroups = input.shortcutGroups.slice(0, halfCount);
  const rightGroups = input.shortcutGroups.slice(halfCount);

  let leftY = ctx.y;
  let rightY = ctx.y;
  for (const g of leftGroups) {
    ctx.y = leftY;
    leftY = shortcutColumn(ctx, g, leftX, colW) + 10;
  }
  for (const g of rightGroups) {
    ctx.y = rightY;
    rightY = shortcutColumn(ctx, g, rightX, colW) + 10;
  }
  ctx.y = Math.max(leftY, rightY);

  // ── Page 2: Dispatch reference ─────────────────────────
  doc.addPage();
  ctx.page = 2;
  header(ctx, `Dispatch Reference — v${input.appVersion}`);

  sectionTitle(ctx, 'Priority Levels');
  priorityTable(ctx, input.priorities);

  ctx.y += 8;
  sectionTitle(ctx, 'Unit Status Codes');
  statusTable(ctx, input.unitStatuses);

  ctx.y += 8;
  sectionTitle(ctx, 'CAD Command Line');
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(COLOR.MUTED);
  doc.text('Press / or F8 in the dispatch console to focus the command line.', PAGE.MARGIN, ctx.y);
  ctx.y += 12;
  doc.setTextColor(COLOR.BLACK);
  commandTable(ctx, input.cadCommands);

  // Footers
  const total = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    ctx.page = p;
    footer(ctx, total);
  }

  return doc;
}

/** Build + open the PDF in a new tab (popup-blocker safe). */
export function generateHelpQuickReferencePdf(input: HelpQuickReferenceInput): void {
  const doc = buildHelpQuickReferencePdf(input);
  const stamp = new Date().toISOString().slice(0, 10);
  openPdfDocument(doc, `RMPG-Flex-Quick-Reference-${stamp}.pdf`);
}

/**
 * Convenience wrapper that pulls the canonical reference data from
 * helpReferenceData.ts and the app version constant. Used by both the
 * Help page Print button and the MenuBar's
 * Help → Training & Docs → Quick Reference Card (PDF) item.
 *
 * Async because the underlying jsPDF builder is sync but callers often
 * lazy-import this whole module — keeping the export awaitable lets the
 * caller `await` without caring about that detail.
 */
export async function generateHelpQuickReferencePdfWithDefaults(): Promise<void> {
  const [{ SHORTCUT_GROUPS, PRIORITIES, UNIT_STATUSES, CAD_COMMANDS }, { APP_VERSION }] = await Promise.all([
    import('./helpReferenceData'),
    import('./version'),
  ]);
  generateHelpQuickReferencePdf({
    shortcutGroups: SHORTCUT_GROUPS,
    priorities: PRIORITIES.map(p => ({ level: p.level, label: p.label, desc: p.desc })),
    unitStatuses: UNIT_STATUSES.map(s => ({ code: s.code, label: s.label, desc: s.desc })),
    cadCommands: CAD_COMMANDS.map(c => ({ cmd: c.cmd, desc: c.desc })),
    appVersion: APP_VERSION,
  });
}
