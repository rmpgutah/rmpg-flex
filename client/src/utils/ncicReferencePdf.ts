// ============================================================
// RMPG Flex — NCIC / NLETS Terminal Operator Reference Guide (PDF)
//
// A printable, laminate-able quick-reference that prints EVERY NCIC/Utah code
// table plus the terminal command reference. The code data is pulled from the
// single source of truth in constants/ncicCodes.ts (getReferenceTables /
// getReferenceOffenses) — this file NEVER duplicates a code table.
//
// Manual table layout (no jspdf-autotable): we track x/y, draw rules with
// doc.line / doc.rect, and add pages with doc.addPage(). Arial-only, embedded
// via registerArialFont. Print-friendly: black text on white, brand-gold
// (#d4a017) accents on section headers/rules only.
// ============================================================

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { getReferenceTables, getReferenceOffenses } from '../constants/ncicCodes';
import { formatEnumValue } from './formatters';
import { drawNavyBanner } from './pdfStandaloneHeader';

// ── Page geometry (points; US Letter = 612 x 792) ────────────────────────────
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 44; // leave room for footer

// ── Colors (print document — NOT app theme tokens) ───────────────────────────
const GOLD: [number, number, number] = [0xd4, 0xa0, 0x17];
const BLACK: [number, number, number] = [0x00, 0x00, 0x00];
const GREY: [number, number, number] = [0x88, 0x88, 0x88];
const RULE_GREY: [number, number, number] = [0xcc, 0xcc, 0xcc];

// ── Terminal command reference (source of truth: NcicQueryPanel welcome block) ─
interface TerminalCommand { cmd: string; desc: string; }
const TERMINAL_COMMANDS: TerminalCommand[] = [
  { cmd: 'QX', desc: 'Cross-Reference (ALL) — runs every query type for a subject' },
  { cmd: 'QH', desc: 'Person / History — query person record + history' },
  { cmd: 'QV', desc: 'Vehicle / Plate — accepts make codes (e.g. TOYT)' },
  { cmd: 'QW', desc: 'Warrants — active warrant check' },
  { cmd: 'QT', desc: 'Phone — reverse phone-number lookup' },
  { cmd: 'QD', desc: "Driver's License — by name or DL number + state" },
  { cmd: 'QA', desc: 'Address / Premise — premise history lookup' },
  { cmd: 'QO', desc: 'OFAC Watchlist — sanctions / watchlist screen' },
  { cmd: 'QR', desc: 'Arrest Records — query arrest history' },
  { cmd: 'QS', desc: 'Skip Tracker — name / address / phone / email trace' },
  { cmd: 'QB', desc: 'Background Check — consolidated background pull' },
  { cmd: 'QC', desc: 'Utah Courts (web) — court case lookup' },
  { cmd: 'QZ', desc: 'Code Translation — decode any NCIC/Utah code or term' },
];

// ── Layout helpers (pure-ish; operate on a jsPDF doc + a y cursor) ────────────

function setFill(doc: jsPDF, c: [number, number, number]) { doc.setFillColor(c[0], c[1], c[2]); }
function setText(doc: jsPDF, c: [number, number, number]) { doc.setTextColor(c[0], c[1], c[2]); }
function setDraw(doc: jsPDF, c: [number, number, number]) { doc.setDrawColor(c[0], c[1], c[2]); }

/** Distribute a column count across CONTENT_W. Returns the x of each column. */
export function columnXs(count: number, gutter = 12): number[] {
  const colW = (CONTENT_W - gutter * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => MARGIN + i * (colW + gutter));
}

/** Width of a single column given a count + gutter. */
export function columnWidth(count: number, gutter = 12): number {
  return (CONTENT_W - gutter * (count - 1)) / count;
}

/** Lay rows into N columns, column-major (fill column 1 top→bottom, then 2…). */
export function chunkColumns<T>(items: T[], cols: number): T[][] {
  const perCol = Math.ceil(items.length / cols);
  const out: T[][] = [];
  for (let c = 0; c < cols; c++) {
    out.push(items.slice(c * perCol, (c + 1) * perCol));
  }
  return out;
}

/** Pick a sensible column count for a table by its row count. */
export function colsForTable(rowCount: number): number {
  if (rowCount > 120) return 4; // VMA (~175)
  if (rowCount > 18) return 3;
  return 2;
}

// Running state for footer/page numbering is handled at finalize time.

function runningHeader(doc: jsPDF, y: number): number {
  setText(doc, GREY);
  doc.setFont('Arial', 'normal');
  doc.setFontSize(7);
  doc.text('NCIC / NLETS TERMINAL — OPERATOR REFERENCE GUIDE', MARGIN, y);
  doc.text('RMPG Flex', PAGE_W - MARGIN, y, { align: 'right' });
  setDraw(doc, RULE_GREY);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y + 3, PAGE_W - MARGIN, y + 3);
  return y + 14;
}

/** Add a page and draw the light running header; returns the new y cursor. */
function newPage(doc: jsPDF): number {
  doc.addPage();
  return runningHeader(doc, MARGIN);
}

/** Ensure `need` points of vertical space remain; page-break if not. */
function ensureSpace(doc: jsPDF, y: number, need: number): number {
  if (y + need > BOTTOM) return newPage(doc);
  return y;
}

/** Draw a gold section header bar with a title. Returns the new y. */
function sectionHeader(doc: jsPDF, y0: number, title: string, subtitle?: string): number {
  let y = ensureSpace(doc, y0, 30);
  setFill(doc, GOLD);
  doc.rect(MARGIN, y, CONTENT_W, 16, 'F');
  setText(doc, BLACK);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.text(title.toUpperCase(), MARGIN + 5, y + 11.5);
  if (subtitle) {
    doc.setFont('Arial', 'normal');
    doc.setFontSize(7.5);
    doc.text(subtitle, PAGE_W - MARGIN - 5, y + 11, { align: 'right' });
  }
  return y + 24;
}

// ── Section renderers ─────────────────────────────────────────────────────────

function renderTitlePage(doc: jsPDF, now: Date): void {
  const stamp = now.toISOString().slice(0, 10);
  drawNavyBanner(doc, {
    title: 'NCIC / NLETS OPERATOR REFERENCE',
    subtitle: 'Rocky Mountain Protective Group · Utah',
    rightLine1: `Generated ${stamp}`,
    y: 8,
    marginPt: 0,
  });

  // Top gold rule
  setFill(doc, GOLD);
  doc.rect(MARGIN, 120, CONTENT_W, 4, 'F');

  setText(doc, BLACK);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(22);
  const titleLines = doc.splitTextToSize(
    'NCIC / NLETS TERMINAL — OPERATOR REFERENCE GUIDE',
    CONTENT_W,
  ) as string[];
  let y = 160;
  for (const line of titleLines) {
    doc.text(line, PAGE_W / 2, y, { align: 'center' });
    y += 28;
  }

  doc.setFont('Arial', 'normal');
  doc.setFontSize(11);
  setText(doc, BLACK);
  doc.text('RMPG Flex · Rocky Mountain Protective Group · Utah', PAGE_W / 2, y + 6, { align: 'center' });

  // bottom gold rule
  setFill(doc, GOLD);
  doc.rect(MARGIN, y + 22, CONTENT_W, 4, 'F');

  // Generated date
  doc.setFontSize(8.5);
  setText(doc, GREY);
  doc.text(`Generated ${stamp}`, PAGE_W / 2, y + 46, { align: 'center' });

  // Footer note about laminating
  doc.setFontSize(8);
  setText(doc, GREY);
  doc.text(
    'Quick-reference — print double-sided and laminate. Codes per NCIC Code Manual / Utah DLD / Utah Code.',
    PAGE_W / 2, PAGE_H - 80, { align: 'center' },
  );
}

function renderTerminalCommands(doc: jsPDF, y0: number): number {
  let y = sectionHeader(doc, y0, 'Terminal Commands', 'enter at the QUERY prompt');

  const cmdColW = 34;
  const rowH = 16;
  doc.setFontSize(8.5);

  for (const c of TERMINAL_COMMANDS) {
    y = ensureSpace(doc, y, rowH);
    // command code
    doc.setFont('Arial', 'bold');
    setText(doc, BLACK);
    doc.text(c.cmd, MARGIN + 2, y + 9);
    // description (wrap into remaining width)
    doc.setFont('Arial', 'normal');
    const descX = MARGIN + cmdColW;
    const lines = doc.splitTextToSize(c.desc, CONTENT_W - cmdColW - 4) as string[];
    let ly = y + 9;
    for (const line of lines) {
      doc.text(line, descX, ly);
      ly += 10;
    }
    const used = Math.max(rowH, (lines.length - 1) * 10 + rowH);
    // light separator
    setDraw(doc, RULE_GREY);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y + used - 3, PAGE_W - MARGIN, y + used - 3);
    y += used;
  }
  return y + 8;
}

function renderCodeTable(
  doc: jsPDF,
  y0: number,
  title: string,
  entries: Array<{ code: string; label: string }>,
): number {
  const cols = colsForTable(entries.length);
  let y = sectionHeader(doc, y0, title, `${entries.length} codes`);

  const colW = columnWidth(cols);
  const xs = columnXs(cols);
  const rowH = 11;
  const codeColW = Math.min(44, colW * 0.42);

  doc.setFontSize(7.5);

  // We render column-major but must page-break as a block. To keep alignment
  // simple and robust across page breaks, render row-by-row across columns.
  const columns = chunkColumns(entries, cols);
  const maxRows = Math.max(...columns.map((c) => c.length), 0);

  for (let r = 0; r < maxRows; r++) {
    const yBefore = y;
    y = ensureSpace(doc, y, rowH);
    if (y < yBefore) {
      // A page break occurred — draw a light continuation label.
      doc.setFontSize(8);
      setText(doc, GREY);
      doc.text(`${title} (continued)`, MARGIN, y);
      setText(doc, BLACK);
      y += 14;
    }
    for (let c = 0; c < cols; c++) {
      const entry = columns[c][r];
      if (!entry) continue;
      const x = xs[c];
      doc.setFont('Arial', 'bold');
      setText(doc, BLACK);
      doc.text(entry.code, x, y + 8);
      doc.setFont('Arial', 'normal');
      setText(doc, BLACK);
      const labelX = x + codeColW;
      const labelW = colW - codeColW;
      const label = (doc.splitTextToSize(entry.label, labelW) as string[])[0] || entry.label;
      doc.text(label, labelX, y + 8);
    }
    y += rowH;
  }
  return y + 8;
}

function renderOffenseTable(doc: jsPDF, y0: number): number {
  const offenses = getReferenceOffenses();
  let y = sectionHeader(doc, y0, 'Utah Offense Codes', `${offenses.length} curated offenses`);

  // Columns: Offense | Utah Statute | Class | NCIC
  const cOffense = MARGIN;
  const wOffense = CONTENT_W * 0.46;
  const cStatute = cOffense + wOffense;
  const wStatute = CONTENT_W * 0.26;
  const cClass = cStatute + wStatute;
  const wClass = CONTENT_W * 0.12;
  const cNcic = cClass + wClass;

  const drawHeaderRow = (yy: number): number => {
    doc.setFont('Arial', 'bold');
    doc.setFontSize(7.5);
    setText(doc, BLACK);
    doc.text('OFFENSE', cOffense + 1, yy + 7);
    doc.text('UTAH STATUTE', cStatute + 1, yy + 7);
    doc.text('CLASS', cClass + 1, yy + 7);
    doc.text('NCIC', cNcic + 1, yy + 7);
    setDraw(doc, BLACK);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, yy + 9.5, PAGE_W - MARGIN, yy + 9.5);
    return yy + 12;
  };

  y = drawHeaderRow(y);

  const rowH = 10;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(7);

  for (const o of offenses) {
    if (y + rowH > BOTTOM) {
      y = newPage(doc);
      y = drawHeaderRow(y);
      doc.setFont('Arial', 'normal');
      doc.setFontSize(7);
    }
    setText(doc, BLACK);
    const offenseText = (doc.splitTextToSize(o.offense, wOffense - 3) as string[])[0] || o.offense;
    doc.text(offenseText, cOffense + 1, y + 7);
    doc.text(o.utahStatute, cStatute + 1, y + 7);
    doc.text(formatEnumValue(o.severity), cClass + 1, y + 7);
    doc.text(o.ncicCode, cNcic + 1, y + 7);
    setDraw(doc, RULE_GREY);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y + rowH - 1, PAGE_W - MARGIN, y + rowH - 1);
    y += rowH;
  }
  return y;
}

/** Stamp "Page X" in the footer of every page (call after all content drawn). */
function stampFooters(doc: jsPDF): void {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont('Arial', 'normal');
    doc.setFontSize(7);
    setText(doc, GREY);
    doc.text(`Page ${p} of ${total}`, PAGE_W / 2, PAGE_H - 24, { align: 'center' });
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

export interface NcicReferencePdfOpts {
  /** When true, return the jsPDF instance instead of calling doc.save(). */
  returnDoc?: boolean;
}

/**
 * Build the NCIC Operator Reference Guide and (by default) trigger a download.
 * `now` is injectable for deterministic tests; the click handler can omit it.
 */
export function generateNcicReferencePdf(
  now: Date = new Date(),
  opts: NcicReferencePdfOpts = {},
): jsPDF | void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);
  doc.setFont('Arial', 'normal');

  // Page 1 — title
  renderTitlePage(doc, now);

  // Section 1 — terminal commands (start a fresh page)
  let y = newPage(doc);
  y = renderTerminalCommands(doc, y);

  // Sections 2..N — one block per code table
  for (const table of getReferenceTables()) {
    y = renderCodeTable(doc, y, table.title, table.entries);
  }

  // Final section — Utah offense codes
  y = renderOffenseTable(doc, y);

  // Footers + page numbers
  stampFooters(doc);

  if (opts.returnDoc) return doc;
  doc.save('NCIC-Reference-Guide.pdf');
}
