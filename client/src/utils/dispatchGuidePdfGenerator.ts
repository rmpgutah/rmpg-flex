// ============================================================
// RMPG Flex — Dispatch Guide PDF Generator
//
// Produces a printable training + quick-reference manual for the
// Dispatch Console. Combines narrative training content (call
// intake, unit status, safety flags, voice features) with a
// one-page quick-reference card at the end for dispatchers to
// tear off and keep at the console.
//
// This file is the SINGLE SOURCE OF TRUTH for the guide — update
// here when dispatch features change and the PDF regenerates on
// the next download click. No static artifact to keep in sync.
// ============================================================

import jsPDF from 'jspdf';

// ─── Layout constants ───────────────────────────────────────
const PAGE = { W: 612, H: 792, MARGIN: 54 }; // US Letter @ 72dpi, 0.75" margins
const LINE_H = 14;
const SECTION_GAP = 18;

const COLOR = {
  BLACK:    '#000000',
  INK:      '#1a1a1a',
  MUTED:    '#666666',
  ACCENT:   '#d4a017',   // Spillman gold
  SURFACE:  '#f4f4f4',
  RULE:     '#cccccc',
  RED:      '#b91c1c',
  GREEN:    '#166534',
};

// ─── Types ──────────────────────────────────────────────────

/**
 * A 10-code or signal code row. The live endpoint
 * `/api/dispatch/geography/codes` returns richer metadata but we only need
 * these three fields to render the reference table; any extra fields are
 * ignored. If the fetch fails, we fall back to the hardcoded tables below.
 */
export interface LiveDispatchCode {
  code: string;
  description: string;
  category?: string;
  /** Status chip rendered next to the code in the roster, if any. */
  status_label?: string;
}

interface SectionAnchor {
  /** Label shown in the cover-page TOC. */
  label: string;
  /** 1-indexed page the section starts on, captured at emit time. */
  page: number;
}

interface GuideContext {
  doc: jsPDF;
  y: number;
  page: number;
  /** Optional live-fetched codes; when null, sections use hardcoded tables. */
  liveCodes: LiveDispatchCode[] | null;
  /** Populated as sections emit; consumed by the cover-page TOC renderer. */
  anchors: SectionAnchor[];
}

/**
 * Record the current page as the start of a section so the cover-page TOC
 * can link to it. Call immediately after `newPage(ctx)` + before `title(...)`.
 */
function anchor(ctx: GuideContext, label: string): void {
  ctx.anchors.push({ label, page: ctx.page });
}

// ─── Primitive helpers ──────────────────────────────────────

function newPage(ctx: GuideContext): void {
  ctx.doc.addPage();
  ctx.page += 1;
  ctx.y = PAGE.MARGIN;
  pageHeader(ctx);
}

function ensureSpace(ctx: GuideContext, need: number): void {
  if (ctx.y + need > PAGE.H - PAGE.MARGIN - 24 /* footer */) {
    newPage(ctx);
  }
}

function pageHeader(ctx: GuideContext): void {
  const d = ctx.doc;
  d.setFont('helvetica', 'bold');
  d.setFontSize(8);
  d.setTextColor(COLOR.MUTED);
  d.text('RMPG Flex — Dispatch Console Guide', PAGE.MARGIN, 34);
  d.setFont('helvetica', 'normal');
  d.text('Rocky Mountain Protective Group', PAGE.W - PAGE.MARGIN, 34, { align: 'right' });
  d.setDrawColor(COLOR.RULE);
  d.setLineWidth(0.5);
  d.line(PAGE.MARGIN, 40, PAGE.W - PAGE.MARGIN, 40);
}

function pageFooter(ctx: GuideContext, total: number): void {
  const d = ctx.doc;
  d.setFont('helvetica', 'normal');
  d.setFontSize(8);
  d.setTextColor(COLOR.MUTED);
  d.text(`Page ${ctx.page} of ${total}`, PAGE.W / 2, PAGE.H - 28, { align: 'center' });
  d.text(generatedStamp(), PAGE.MARGIN, PAGE.H - 28);
  d.text('CONFIDENTIAL — AUTHORIZED USE ONLY', PAGE.W - PAGE.MARGIN, PAGE.H - 28, { align: 'right' });
}

function generatedStamp(): string {
  const d = new Date();
  return `Generated ${d.toISOString().slice(0, 10)}`;
}

function title(ctx: GuideContext, text: string, size = 18): void {
  ensureSpace(ctx, size + SECTION_GAP);
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(size);
  ctx.doc.setTextColor(COLOR.BLACK);
  ctx.doc.text(text, PAGE.MARGIN, ctx.y + size);
  ctx.y += size + 4;
}

function h2(ctx: GuideContext, text: string): void {
  ensureSpace(ctx, 30);
  ctx.y += 8;
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(13);
  ctx.doc.setTextColor(COLOR.ACCENT);
  ctx.doc.text(text, PAGE.MARGIN, ctx.y + 13);
  ctx.y += 16;
  ctx.doc.setDrawColor(COLOR.ACCENT);
  ctx.doc.setLineWidth(1);
  ctx.doc.line(PAGE.MARGIN, ctx.y, PAGE.MARGIN + 48, ctx.y);
  ctx.y += 8;
}

function h3(ctx: GuideContext, text: string): void {
  ensureSpace(ctx, 22);
  ctx.y += 4;
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(11);
  ctx.doc.setTextColor(COLOR.INK);
  ctx.doc.text(text, PAGE.MARGIN, ctx.y + 11);
  ctx.y += 16;
}

function paragraph(ctx: GuideContext, text: string, indent = 0): void {
  ctx.doc.setFont('helvetica', 'normal');
  ctx.doc.setFontSize(10);
  ctx.doc.setTextColor(COLOR.INK);
  const maxW = PAGE.W - PAGE.MARGIN * 2 - indent;
  const lines = ctx.doc.splitTextToSize(text, maxW) as string[];
  for (const line of lines) {
    ensureSpace(ctx, LINE_H);
    ctx.doc.text(line, PAGE.MARGIN + indent, ctx.y + 10);
    ctx.y += LINE_H;
  }
  ctx.y += 4;
}

function bullet(ctx: GuideContext, text: string): void {
  ctx.doc.setFont('helvetica', 'normal');
  ctx.doc.setFontSize(10);
  ctx.doc.setTextColor(COLOR.INK);
  const maxW = PAGE.W - PAGE.MARGIN * 2 - 14;
  const lines = ctx.doc.splitTextToSize(text, maxW) as string[];
  for (let i = 0; i < lines.length; i++) {
    ensureSpace(ctx, LINE_H);
    if (i === 0) {
      ctx.doc.setFont('helvetica', 'bold');
      ctx.doc.text('•', PAGE.MARGIN + 4, ctx.y + 10);
      ctx.doc.setFont('helvetica', 'normal');
    }
    ctx.doc.text(lines[i], PAGE.MARGIN + 14, ctx.y + 10);
    ctx.y += LINE_H;
  }
}

function calloutBox(ctx: GuideContext, label: string, body: string, tone: 'info' | 'warn' = 'info'): void {
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(10);
  const maxW = PAGE.W - PAGE.MARGIN * 2 - 20;
  const bodyLines = ctx.doc.splitTextToSize(body, maxW) as string[];
  const boxH = 20 + bodyLines.length * LINE_H;
  ensureSpace(ctx, boxH + 6);

  ctx.doc.setFillColor(tone === 'warn' ? '#fff4f2' : '#fffbea');
  ctx.doc.setDrawColor(tone === 'warn' ? COLOR.RED : COLOR.ACCENT);
  ctx.doc.setLineWidth(1);
  ctx.doc.rect(PAGE.MARGIN, ctx.y, PAGE.W - PAGE.MARGIN * 2, boxH, 'FD');

  ctx.doc.setTextColor(tone === 'warn' ? COLOR.RED : COLOR.ACCENT);
  ctx.doc.setFontSize(9);
  ctx.doc.text(label.toUpperCase(), PAGE.MARGIN + 10, ctx.y + 14);

  ctx.doc.setFont('helvetica', 'normal');
  ctx.doc.setFontSize(10);
  ctx.doc.setTextColor(COLOR.INK);
  for (let i = 0; i < bodyLines.length; i++) {
    ctx.doc.text(bodyLines[i], PAGE.MARGIN + 10, ctx.y + 28 + i * LINE_H);
  }
  ctx.y += boxH + 8;
}

/**
 * Draw a table with `cols` columns and `rows` of data. Column widths
 * are proportional to `colWeights`. Header row is bolded + filled.
 */
function table(
  ctx: GuideContext,
  headers: string[],
  rows: string[][],
  colWeights: number[],
  fontSize = 9,
): void {
  const contentW = PAGE.W - PAGE.MARGIN * 2;
  const totalW = colWeights.reduce((a, b) => a + b, 0);
  const colWidths = colWeights.map((w) => (w / totalW) * contentW);
  const rowH = fontSize + 8;
  const padding = 4;

  const drawRow = (cells: string[], isHeader: boolean): void => {
    ctx.doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
    ctx.doc.setFontSize(fontSize);
    ctx.doc.setTextColor(isHeader ? COLOR.BLACK : COLOR.INK);

    // Compute row height based on wrapped content
    const cellLines = cells.map((cell, i) =>
      ctx.doc.splitTextToSize(cell, colWidths[i] - padding * 2) as string[],
    );
    const maxLines = Math.max(1, ...cellLines.map((l) => l.length));
    const dynamicH = Math.max(rowH, maxLines * (fontSize + 4) + 4);

    ensureSpace(ctx, dynamicH);

    if (isHeader) {
      ctx.doc.setFillColor(COLOR.SURFACE);
      ctx.doc.rect(PAGE.MARGIN, ctx.y, contentW, dynamicH, 'F');
    }

    ctx.doc.setDrawColor(COLOR.RULE);
    ctx.doc.setLineWidth(0.5);
    let x = PAGE.MARGIN;
    for (let i = 0; i < cells.length; i++) {
      ctx.doc.rect(x, ctx.y, colWidths[i], dynamicH, 'S');
      for (let li = 0; li < cellLines[i].length; li++) {
        ctx.doc.text(cellLines[i][li], x + padding, ctx.y + fontSize + 2 + li * (fontSize + 4));
      }
      x += colWidths[i];
    }
    ctx.y += dynamicH;
  };

  drawRow(headers, true);
  for (const row of rows) drawRow(row, false);
  ctx.y += 4;
}

// ─── Diagram primitives ─────────────────────────────────────
// Shared low-level helpers for building vector diagrams throughout the
// guide. Everything below assumes the Spillman dark-console aesthetic:
// black fills, gold accents, thin gray rules, gold arrowheads. All sizes
// are in PDF points (1/72"). All coordinates are absolute on the page.

/**
 * Draw a labeled rectangle node. Used as the standard "state box" or
 * "component box" building block for state machines, data flows, and
 * architecture diagrams. Returns the rect for chaining.
 */
function dBox(
  d: jsPDF,
  x: number, y: number, w: number, h: number,
  label: string,
  opts: { fill?: string; stroke?: string; textColor?: string; fontSize?: number; bold?: boolean } = {},
): { x: number; y: number; w: number; h: number } {
  const fill = opts.fill ?? '#141414';
  const stroke = opts.stroke ?? '#2e2e2e';
  const textColor = opts.textColor ?? '#e5e5e5';
  const fontSize = opts.fontSize ?? 9;

  d.setFillColor(fill);
  d.setDrawColor(stroke);
  d.setLineWidth(0.75);
  d.roundedRect(x, y, w, h, 2, 2, 'FD');
  d.setFont('helvetica', opts.bold ? 'bold' : 'normal');
  d.setFontSize(fontSize);
  d.setTextColor(textColor);
  const lines = d.splitTextToSize(label, w - 8) as string[];
  const totalH = lines.length * (fontSize + 2);
  const startY = y + (h - totalH) / 2 + fontSize;
  for (let i = 0; i < lines.length; i++) {
    d.text(lines[i], x + w / 2, startY + i * (fontSize + 2), { align: 'center' });
  }
  return { x, y, w, h };
}

/**
 * Arrow from (x1,y1) to (x2,y2) with a gold arrowhead at the destination.
 * Optional label sits at the midpoint above the line.
 */
function dArrow(
  d: jsPDF,
  x1: number, y1: number, x2: number, y2: number,
  label?: string,
  color = '#d4a017',
): void {
  d.setDrawColor(color);
  d.setLineWidth(0.9);
  d.line(x1, y1, x2, y2);

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const ah = 6;
  const aw = 3;
  const baseX = x2 - ah * Math.cos(angle);
  const baseY = y2 - ah * Math.sin(angle);
  const perpX = aw * Math.sin(angle);
  const perpY = -aw * Math.cos(angle);
  d.setFillColor(color);
  d.triangle(
    x2, y2,
    baseX + perpX, baseY + perpY,
    baseX - perpX, baseY - perpY,
    'F',
  );

  if (label) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    d.setFont('helvetica', 'normal');
    d.setFontSize(7);
    d.setTextColor('#888888');
    d.text(label, mx, my - 3, { align: 'center' });
  }
}

/** Caption below a diagram; advances the y-cursor. */
function dCaption(ctx: GuideContext, text: string): void {
  const d = ctx.doc;
  d.setFont('helvetica', 'italic');
  d.setFontSize(8);
  d.setTextColor(COLOR.MUTED);
  d.text(text, PAGE.MARGIN, ctx.y);
  ctx.y += 14;
}

/** Black-with-gold-border container frame for diagrams. */
function dFrame(
  d: jsPDF,
  x: number, y: number, w: number, h: number,
): void {
  d.setFillColor('#0a0a0a');
  d.setDrawColor(COLOR.ACCENT);
  d.setLineWidth(1);
  d.rect(x, y, w, h, 'FD');
}

// ─── Content blocks ─────────────────────────────────────────

/**
 * Draw a small stylized console-mockup badge on the cover.
 * Pure jsPDF vectors so it stays crisp at any zoom and adds no image payload.
 */
function coverConsoleBadge(d: jsPDF, cx: number, topY: number): void {
  const bw = 220;
  const bh = 120;
  const x = cx - bw / 2;
  const y = topY;

  // Outer bezel (dark console)
  d.setFillColor('#0a0a0a');
  d.setDrawColor(COLOR.ACCENT);
  d.setLineWidth(1.5);
  d.rect(x, y, bw, bh, 'FD');

  // Inner screen area
  d.setFillColor('#141414');
  d.setDrawColor('#222222');
  d.setLineWidth(0.75);
  d.rect(x + 8, y + 22, bw - 16, bh - 40, 'FD');

  // Header strip
  d.setFillColor(COLOR.ACCENT);
  d.rect(x, y, bw, 14, 'F');
  d.setFont('helvetica', 'bold');
  d.setFontSize(7);
  d.setTextColor(COLOR.BLACK);
  d.text('RMPG DISPATCH', x + 6, y + 10);
  d.text('P1:0  P2:0  AVAIL:0', x + bw - 6, y + 10, { align: 'right' });

  // LED dots (red / amber / green)
  const ledY = y + 7;
  [['#c0392b', 6], ['#d4a017', 14], ['#166534', 22]].forEach(([color, dx]) => {
    d.setFillColor(color as string);
    d.circle(x + bw - 80 + (dx as number), ledY, 2, 'F');
  });

  // Fake call rows (thin bars)
  d.setFillColor('#d4a017');
  d.rect(x + 14, y + 32, 4, 10, 'F');
  d.setFillColor('#666666');
  d.rect(x + 22, y + 34, 100, 2, 'F');
  d.rect(x + 22, y + 39, 70, 2, 'F');

  d.setFillColor('#b91c1c');
  d.rect(x + 14, y + 48, 4, 10, 'F');
  d.setFillColor('#666666');
  d.rect(x + 22, y + 50, 120, 2, 'F');
  d.rect(x + 22, y + 55, 60, 2, 'F');

  d.setFillColor('#888888');
  d.rect(x + 14, y + 64, 4, 10, 'F');
  d.setFillColor('#666666');
  d.rect(x + 22, y + 66, 90, 2, 'F');
  d.rect(x + 22, y + 71, 110, 2, 'F');

  // Command line strip
  d.setFillColor('#000000');
  d.rect(x + 8, y + bh - 14, bw - 16, 8, 'F');
  d.setFont('courier', 'bold');
  d.setFontSize(6);
  d.setTextColor(COLOR.ACCENT);
  d.text('> CMD:', x + 12, y + bh - 8);
}

function coverPage(ctx: GuideContext): void {
  const d = ctx.doc;
  const cx = PAGE.W / 2;

  // Subtle gold top stripe
  d.setFillColor(COLOR.ACCENT);
  d.rect(0, 0, PAGE.W, 4, 'F');

  // Console-mockup badge up top
  coverConsoleBadge(d, cx, 60);

  // Gold bar
  d.setFillColor(COLOR.ACCENT);
  d.rect(0, 210, PAGE.W, 6, 'F');

  d.setFont('helvetica', 'bold');
  d.setFontSize(32);
  d.setTextColor(COLOR.BLACK);
  d.text('DISPATCH CONSOLE', cx, 260, { align: 'center' });

  d.setFontSize(18);
  d.text('Training & Quick Reference Guide', cx, 290, { align: 'center' });

  d.setFont('helvetica', 'normal');
  d.setFontSize(11);
  d.setTextColor(COLOR.MUTED);
  d.text('Rocky Mountain Protective Group  •  Salt Lake City, Utah', cx, 312, { align: 'center' });

  // Second gold bar — separates hero from TOC
  d.setFillColor(COLOR.ACCENT);
  d.rect(0, 338, PAGE.W, 3, 'F');

  // Contents heading
  d.setFont('helvetica', 'bold');
  d.setFontSize(11);
  d.setTextColor(COLOR.BLACK);
  d.text('CONTENTS', cx, 360, { align: 'center' });
  d.setDrawColor(COLOR.ACCENT);
  d.setLineWidth(1);
  d.line(cx - 30, 363, cx + 30, 363);

  // Clickable TOC entries in a 2-column layout. Each row is
  //   <label>  ........................  <page>
  // and the whole row is a click-target that jumps to that page.
  const entries = ctx.anchors;
  const colW = (PAGE.W - PAGE.MARGIN * 2 - 30) / 2;
  const rowH = 14;
  const halfCount = Math.ceil(entries.length / 2);
  const tocTopY = 380;

  d.setFont('helvetica', 'normal');
  d.setFontSize(9.5);
  d.setTextColor(COLOR.INK);

  for (let i = 0; i < entries.length; i++) {
    const col = i < halfCount ? 0 : 1;
    const rowInCol = i < halfCount ? i : i - halfCount;
    const x = PAGE.MARGIN + col * (colW + 30);
    const y = tocTopY + rowInCol * rowH;
    const entry = entries[i];

    const labelW = d.getTextWidth(entry.label);
    const pageStr = String(entry.page);
    const pageW = d.getTextWidth(pageStr);
    const dotsStart = x + labelW + 4;
    const dotsEnd = x + colW - pageW - 4;

    d.setTextColor(COLOR.INK);
    d.text(entry.label, x, y);

    // Dotted leader
    d.setTextColor(COLOR.MUTED);
    if (dotsEnd > dotsStart) {
      const dotWidth = d.getTextWidth('.');
      const dotCount = Math.max(0, Math.floor((dotsEnd - dotsStart) / dotWidth));
      d.text('.'.repeat(dotCount), dotsStart, y);
    }

    d.setTextColor(COLOR.INK);
    d.text(pageStr, x + colW - pageW, y);

    // Make the whole row clickable — jsPDF expects the top-left of the
    // link rect, and text was drawn with y as the baseline, so shift up.
    d.link(x, y - 10, colW, rowH, { pageNumber: entry.page });
  }

  // Bottom stamp
  d.setFontSize(9);
  d.setTextColor(COLOR.MUTED);
  d.text(`${generatedStamp()}  •  CONFIDENTIAL — AUTHORIZED USE ONLY`, cx, PAGE.H - 48, { align: 'center' });
  d.setFontSize(8);
  d.text('Tap any entry above to jump to that section', cx, PAGE.H - 32, { align: 'center' });
}

function section1(ctx: GuideContext): void {
  title(ctx, '1. Console Overview');

  paragraph(ctx,
    'The Dispatch Console is the control center for managing active calls-for-service, unit status, and field activity. It combines a real-time call stack, unit roster, map, and a command line that mirrors traditional CAD radio shorthand. Everything you see updates live across every connected workstation via WebSocket — when another dispatcher changes a unit\'s status, your screen reflects it within roughly one second. There is no manual refresh; the authoritative state lives on the server, and your screen is always rendering the latest snapshot.',
  );

  paragraph(ctx,
    'The console is designed around one principle: the dispatcher should never have to hunt for information. Everything an officer might ask you for — nearest unit, premise alerts, outstanding warrants on a subject, priority call count, beat assignment — should be visible or one hotkey away. If you find yourself clicking through more than two menus to answer a question, there is almost certainly a command-line shortcut that gets you there instantly. Section 6 covers those.',
  );

  h2(ctx, 'Screen Layout');
  paragraph(ctx,
    'The desktop layout has six regions. On mobile and tablet the same panels collapse into a drawer, but the keyboard-first workflow is designed for the desktop console:',
  );
  bullet(ctx, 'Brand bar (52px tall) — agency logo, workstation identifier, and the current dispatcher\'s name and role. The role badge is color-coded: gold for admin, gray for dispatcher, blue for supervisor.');
  bullet(ctx, 'Menu bar (22px) — File, View, Tools, Help dropdowns plus the global search box. Press Alt-F / Alt-V / Alt-T / Alt-H to open each menu with the keyboard.');
  bullet(ctx, 'Icon toolbar (46px) — quick-jump buttons to Dispatch, Map, Records, BOLO, Warrants, Incidents, Citations, Cases. Each icon has an F-key mapping listed in Help -> Keyboard Shortcuts.');
  bullet(ctx, 'Call list (left column, default 320px wide) — every active call sorted by priority descending, then by age. Pending calls float to the top within their priority class. Priority tint: red background for P1, orange for P2, yellow for P3, gray for P4.');
  bullet(ctx, 'Unit roster (center column, default 280px) — grouped by status: Available, Dispatched, Enroute, On Scene, Busy, Out of Service, Off Duty. The group header shows the count; click it to collapse. An LED dot next to each call sign indicates GPS freshness: green = updated within 2 minutes, amber = 2-10 minutes, red = stale beyond 10 minutes.');
  bullet(ctx, 'Detail pane (right column, default 480px) — everything about the selected call: address with map pin, caller info, narrative notes (newest at top), linked persons and vehicles, safety flags, disposition, and the full audit log.');
  bullet(ctx, 'Map (bottom half or separate tab depending on your view) — unit GPS pins, active call markers, beat polygons colored by sector, optional offline tile layer. Click any pin to jump the detail pane to that unit or call.');
  bullet(ctx, 'Status bar (22px tall at the bottom, always visible) — live counts of P1/P2 calls, units dispatched, F-key hint strip, system clock (America/Denver), WebSocket connection indicator, and the master sound toggle.');

  h2(ctx, 'Reading the Screen at a Glance');
  paragraph(ctx,
    'The Spillman-Flex-inspired visual language is dense by design — every pixel of screen real estate carries information. The colors and LEDs mean specific things:',
  );
  bullet(ctx, 'Green LED (solid) — in service, fresh GPS, healthy connection.');
  bullet(ctx, 'Amber LED (solid) — attention needed, stale GPS, moderate-severity alert in the brain queue.');
  bullet(ctx, 'Red LED (solid or pulsing) — emergency, panic, officer-down, or major-severity alert. Pulsing means active and unresolved.');
  bullet(ctx, 'Gold text (#d4a017) — actionable brand accent. Buttons with gold borders are the primary action on their panel.');
  bullet(ctx, 'Gray text (#888888) — passive label text. Values and data use light gray (#dddddd).');
  bullet(ctx, 'Red priority stripe on a call card — the call has one or more safety flags. Hover for the flag list.');
  bullet(ctx, 'Flashing red banner across the top of the map — active pursuit in progress.');
  bullet(ctx, 'Italic white on gold — the currently-selected call or unit. Only one item at a time carries this treatment.');

  h2(ctx, 'Resizable Panels');
  paragraph(ctx,
    'Every vertical divider between panels is draggable. Your layout persists in local storage per workstation, so the view you leave at the end of one shift is the view you pick up on the next. Two common layouts are worth knowing:',
  );
  bullet(ctx, 'Busy-shift layout — widen the call list to ~40% of the screen and narrow the map to the bottom 25%. You can see a dozen pending calls at once and triage by priority without scrolling.');
  bullet(ctx, 'Shift-change layout — widen the unit roster to 40% so the whole fleet fits without scrolling. Use this during the five-minute window after shift change when you are verifying every unit has logged in.');
  bullet(ctx, 'Map-heavy layout — collapse the detail pane to its minimum width and expand the map to two-thirds of the screen. Useful during pursuits, multi-unit tactical operations, or when coordinating a search grid.');

  calloutBox(ctx, 'Tip',
    'Press F1 at any time to open the on-screen keyboard-shortcut overlay. It highlights the active hotkeys for whatever panel currently has focus. Press F1 again or Escape to dismiss.',
  );

  h2(ctx, 'Keyboard-First Philosophy');
  paragraph(ctx,
    'Traditional CAD systems were built for keyboard operators who never lifted their hands from the home row. RMPG Flex preserves that model wherever possible: every action that happens more than once in a shift has an F-key or command-line shortcut. The mouse is useful for map inspection and reviewing historical records, but for live call management you should be faster with the keyboard. Accept the learning curve — a dispatcher who has memorized the command line will out-triage a dispatcher who clicks through menus by roughly three-to-one on a busy night.',
  );
  paragraph(ctx,
    'A good dispatcher-in-training drill: pick five common actions (new call, assign unit, mark on-scene, clear call, run plate) and practice doing each without touching the mouse. Section 5 and Section 6 together cover every hotkey and verb you need for those five and many more.',
  );

  h2(ctx, 'Connectivity & Offline Behavior');
  paragraph(ctx,
    'The console degrades gracefully when the network flakes. The WebSocket connection indicator in the status bar shows four states: CONNECTED (green), RECONNECTING (amber pulse), DISCONNECTED (red), and OFFLINE-READ-ONLY (red with a lock icon). In disconnected mode, the console continues to display the last-known state and queues your local writes in IndexedDB — when the WebSocket reconnects, writes replay to the server in the order you made them. Offline mode exists primarily for the Electron desktop wrapper on mobile patrol laptops; production dispatch workstations should never lose connectivity for more than a few seconds.',
  );

  paragraph(ctx,
    'If you see the reconnecting indicator for more than thirty seconds, manually refresh the page (Ctrl+R on Windows, Cmd+R on Mac). If the page does not load after a refresh, move to the next workstation and notify the on-call admin. The fastest path to restored service is almost always another healthy workstation and a ticket to IT — not troubleshooting on the broken one.',
  );

  calloutBox(ctx, 'Emergency Fallback',
    'If the console is fully unreachable during a shift (server down, network severed), fall back to radio plus paper logs immediately. When service returns, the dispatch audit log can be reconstructed from the radio recording system. Never delay a response waiting for the console to come back.',
    'warn',
  );
}

function section2(ctx: GuideContext): void {
  title(ctx, '2. Taking a Call End-to-End');

  paragraph(ctx,
    'A typical call flows through six states: pending, dispatched, enroute, on-scene, clearing, archived. Every transition is audited with a server-side timestamp, the dispatcher who triggered it, and the unit involved. That audit trail is what makes dispatch a legal record — you cannot erase it, you can only add correcting notes on top. Assume everything you type, click, or say through the voice channel is permanent and discoverable in court.',
  );

  paragraph(ctx,
    'This section walks through a typical call from ring-in to archive, with the keystrokes, the required fields, and the judgment calls that only a human can make. Section 8 covers specific workflows (pursuits, multi-unit, mental-health response) in detail.',
  );

  drawCallLifecycleDiagram(ctx);

  h2(ctx, 'Step 1 — Create the call');
  paragraph(ctx,
    'The clock starts when the phone rings. Your first obligation is life safety — get enough information to send help quickly, then refine as the caller talks. Do not wait for a complete picture before opening the call record.',
  );
  bullet(ctx, 'Press F2 or click "New Call" in the call list. The intake form opens with your cursor already in the incident-type field.');
  bullet(ctx, 'Type the incident type. Autocomplete surfaces matching types as you type — "dom" shows "Domestic Disturbance", "Domestic Violence", "Domestic Medical"; "sus" shows "Suspicious Person", "Suspicious Vehicle", "Suspicious Circumstances". Tab to accept a suggestion.');
  bullet(ctx, 'Address: start typing, the map geocodes as you go. Utah-specific addresses (e.g. "1234 S 500 E, SLC") and apartment numbers are supported. Verify the pin on the map before saving — a misgeocoded address sends units to the wrong block and costs minutes.');
  bullet(ctx, 'If the caller cannot give an address, use cross streets ("Main and Center") or a landmark ("Smith\'s Grocery parking lot"). The geocoder understands these but the pin will be less precise.');
  bullet(ctx, 'Caller info: name, callback number (required for any incident that may need follow-up), relationship to incident (victim, witness, involved, reporting party).');
  bullet(ctx, 'Priority auto-populates from incident type but you can override in the P1-P4 dropdown. If the caller describes active violence, weapons, or immediate threat to life, upgrade to P1 regardless of the default.');
  bullet(ctx, 'Flag safety concerns BEFORE saving: weapons, DV, felony in progress, mental health crisis, officer safety caution, pursuit, hazmat, juvenile involved. Section 4 details each.');
  bullet(ctx, 'Click Save (or press Ctrl+Enter). The call appears at the top of the pending list and broadcasts to every connected workstation. All dispatchers see it immediately.');

  calloutBox(ctx, 'Save Early, Refine Often',
    'It is better to save a call with incomplete information and dispatch a unit in 30 seconds than to wait 90 seconds for complete information before saving. Units can be enroute while you continue gathering details from the caller. The notes field accepts updates in real time and broadcasts every change.',
  );

  h2(ctx, 'Step 1.5 — Key intake questions');
  paragraph(ctx,
    'Whatever your agency\'s intake script requires, these eight questions cover ninety percent of calls and should become automatic:',
  );
  bullet(ctx, 'Where is this happening? (address or cross streets)');
  bullet(ctx, 'What is happening? (nature of the incident in one sentence)');
  bullet(ctx, 'Is anyone hurt? Do you need medical?');
  bullet(ctx, 'Are weapons involved or has anyone mentioned weapons?');
  bullet(ctx, 'Is the suspect still there? If not, which direction did they go? How long ago?');
  bullet(ctx, 'Description of suspect: height, build, clothing, hair, distinctive features.');
  bullet(ctx, 'Your name and a callback number in case we get disconnected.');
  bullet(ctx, 'Is there anything else responding officers should know before they arrive?');

  h2(ctx, 'Step 2 — Assign a unit');
  paragraph(ctx,
    'Who you send depends on three things: proximity, specialty, and availability. The unit roster shows each unit\'s current status and GPS-derived distance from the call (when GPS is fresh). Availability ordering is: Available > Busy-but-clearing-soon > Dispatched-to-lower-priority > Out-of-service.',
  );
  bullet(ctx, 'Select the call (click it or use CI <call#> in the command line — see Section 6).');
  bullet(ctx, 'Press F3 or click Dispatch, then pick a unit from the available roster. The roster reorders to put the closest available units at the top.');
  bullet(ctx, 'Specialty calls need specialty units: K9 requests go to K9-capable units, mental-health calls go to CIT-trained officers when available, hazmat requires HazMat-certified responders.');
  bullet(ctx, 'The unit receives the call on their mobile/MDT within two seconds; status changes to "dispatched" and they acknowledge by setting 10-4 or their own status.');
  bullet(ctx, 'For P1 or multi-unit calls, dispatch a second unit immediately. The Dispatcher Brain (Section 7) will prompt you to do this if it detects a felony-in-progress with only one unit assigned.');
  bullet(ctx, 'EMS and Fire: coordinate through their own dispatch (separate radio + separate CAD) but record your coordination in the call notes so the audit trail is complete.');

  h2(ctx, 'Step 3 — Track status transitions');
  paragraph(ctx,
    'Units drive their own status in the field — the F-keys on your console are for cases where you need to force a status change (bad GPS, unit cannot reach their MDT, verbal request over the radio). Expected transition times on a typical response:',
  );
  bullet(ctx, 'Dispatched to Enroute: under 60 seconds. If longer, check radio.');
  bullet(ctx, 'Enroute to On Scene: varies by distance and priority. P1 lights-and-siren calls within three miles should arrive in 3-5 minutes. If a P1 has been enroute for more than eight minutes with no on-scene, that is a red flag — radio check.');
  bullet(ctx, 'On Scene to Clear: varies wildly by call type. Welfare checks may clear in 10 minutes, DV investigations may take 90.');
  bullet(ctx, 'F5 = En Route (unit acknowledged and is moving).');
  bullet(ctx, 'F6 = On Scene (unit has arrived). The eight-minute welfare-check timer starts automatically when you or the unit sets this status.');
  bullet(ctx, 'F7 = Clear (call resolved). Prompts for disposition code.');

  calloutBox(ctx, 'Red Flag',
    'A unit that stops updating status or moving on GPS while on a call is a welfare-check trigger. Radio the unit. No response within two minutes, dispatch a cover unit and escalate to supervisor. The brain\'s overdue-status rule (8 minutes on-scene with no status update) is your safety net, not your primary awareness — you should notice before the brain speaks.',
    'warn',
  );

  h2(ctx, 'Step 4 — Document during the call');
  paragraph(ctx,
    'Use the notes field continuously. Every note timestamps and broadcasts so another dispatcher can pick up mid-call without asking "what is happening?". The rule of thumb: anything you would say on the radio to brief a supervisor should also appear as a note.',
  );
  h3(ctx, 'What makes a good note');
  bullet(ctx, 'Timestamped by the system — you do not need to write the time yourself.');
  bullet(ctx, 'Attributable — your note is saved under your user account; readers know who wrote it.');
  bullet(ctx, 'Objective and observational — "caller states subject is in the garage" not "caller sounds nervous, probably lying".');
  bullet(ctx, 'Specific — "male, 30s, red hoodie, black backpack, last seen WB on 400 S" beats "suspect ran".');
  bullet(ctx, 'Linked — add persons and vehicles to the call as structured records rather than just mentioning them in prose. Structured records carry into incident reports and searches.');

  h3(ctx, 'What NOT to put in notes');
  bullet(ctx, 'Speculation about guilt or innocence. "Looks guilty" has no place in a permanent record.');
  bullet(ctx, 'Protected health information beyond what is operationally necessary. "Subject appears intoxicated" is fine; specific diagnoses are not.');
  bullet(ctx, 'Opinions about officers, colleagues, or supervisors. Use the appropriate HR or supervisor-feedback channel instead.');
  bullet(ctx, 'Personal information about uninvolved third parties.');
  bullet(ctx, 'Profanity or slang that would embarrass the agency if read in court.');

  h2(ctx, 'Step 5 — Convert to incident (if required)');
  paragraph(ctx,
    'Many calls resolve without generating a formal incident report. A welfare check where the subject is fine, a noise complaint that quiets down, a suspicious vehicle that turns out to be a neighbor — these clear without a report. But a call requires an incident report any time any of the following is true:',
  );
  bullet(ctx, 'An arrest was made.');
  bullet(ctx, 'Any person was injured, whether by suspect, officer, or accident.');
  bullet(ctx, 'Property damage occurred or was reported.');
  bullet(ctx, 'A crime victim wants a report for insurance, protection order, or prosecution.');
  bullet(ctx, 'A use-of-force event happened.');
  bullet(ctx, 'The call involved a domestic-violence incident (regardless of arrest).');
  bullet(ctx, 'A juvenile was the victim, subject, or witness to a crime.');
  bullet(ctx, 'A supervisor, officer, or prosecutor requests a report for any reason.');

  paragraph(ctx,
    'From the detail pane of the open call, click "Convert to Incident". Persons, vehicles, the full notes timeline, and all linked records auto-carry into the incident — the officer only adds the narrative and any evidence or charges that the call record did not already capture.',
  );

  h2(ctx, 'Step 6 — Clear the call');
  paragraph(ctx,
    'Clearing is the final act on a call and should never be rushed. Once archived, the disposition cannot be edited — you can only add correction notes on top. Verify with the officer that they are actually clear before pressing F7.',
  );
  bullet(ctx, 'Press F7 with the call selected. The disposition dialog opens.');
  bullet(ctx, 'Choose a disposition code — "Arrest Made", "Report Taken", "Gone On Arrival", "Unfounded", "Assistance Rendered", "Referred to Other Agency", "Canceled by Caller", etc.');
  bullet(ctx, 'Add a brief disposition note summarizing the outcome. One or two sentences is enough.');
  bullet(ctx, 'Save. The call moves to "archived" and becomes searchable from Records.');
  bullet(ctx, 'The unit automatically returns to "available" unless they have separately requested out-of-service, are assigned to another call, or have logged off duty.');

  h2(ctx, 'Handoffs Mid-Call');
  paragraph(ctx,
    'Every call is a shared state across every dispatcher in the room. If you have to step away mid-call — restroom, phone call, another dispatcher\'s emergency — the call continues living in the pending or active lists and any dispatcher can take over. The handoff itself is implicit in the system design, but a verbal handoff to the dispatcher sitting next to you is still best practice on any non-trivial call.',
  );
  bullet(ctx, 'On P1 / active-violence calls, never leave without verbally handing off.');
  bullet(ctx, 'On routine calls, a quick "I have call CN-26-0457 under control, stepping away for 5 minutes" is enough.');
  bullet(ctx, 'The audit log shows every dispatcher who has touched the call, so there is no ambiguity about who did what.');
  bullet(ctx, 'If a call crosses shift change, the outgoing dispatcher should bring the incoming dispatcher up to speed verbally AND in the shift handoff note field. Section 8 covers shift-change procedure in detail.');
}

function section3(ctx: GuideContext): void {
  title(ctx, '3. Unit Status & 10-Codes');

  paragraph(ctx,
    'RMPG Flex accepts the standard 10-codes used across Utah law enforcement, plus a set of agency-specific signal codes. Officers can speak codes through the voice channel, type them on the command line, click status chips in the roster, or tap them on their mobile MDT. However they are triggered, the status transition broadcasts to every dispatcher in real time.',
  );

  paragraph(ctx,
    'A common question during training is "why 10-codes instead of plain English?" The answer is threefold: brevity on a crowded radio channel, privacy from bystanders and scanners, and unambiguous meaning. "Ten-ninety-seven" is impossible to confuse with any other transmission; "on scene" can get cut off in radio traffic and become "scene" which means nothing specific.',
  );

  drawUnitStatusDiagram(ctx);

  h2(ctx, '10-Code Reference');
  paragraph(ctx,
    'This is the full set recognized by the CAD command line and voice channel. Cells in the Status column match the unit-status values that appear in the roster.',
  );
  // Prefer live codes from /api/dispatch/geography/codes so a code added via
  // the admin UI shows up in the next generated guide without a code change.
  // If the fetch failed (offline dispatcher, auth cookie expired, etc.), fall
  // back to the canonical hardcoded set below — the guide must never refuse
  // to download because the network hiccuped.
  const hardcoded10Codes: string[][] = [
    ['10-1',  '-',           'Receiving poorly / signal weak'],
    ['10-2',  '-',           'Receiving well'],
    ['10-3',  '-',           'Stop transmitting'],
    ['10-4',  'ACK',         'Acknowledged / understood'],
    ['10-5',  '-',           'Relay (pass message to third party)'],
    ['10-6',  'BUSY',        'Busy — not immediately available'],
    ['10-7',  'OUT SERVICE', 'Out of service (meals, fuel, admin)'],
    ['10-7B', 'OUT SERVICE', 'Out of service for restroom'],
    ['10-7C', 'OUT SERVICE', 'Out of service for court'],
    ['10-8',  'AVAILABLE',   'In service, available for calls'],
    ['10-9',  '-',           'Repeat last transmission'],
    ['10-10', 'BREAK',       'On break / off duty temporarily'],
    ['10-15', '-',           'Prisoner in custody / transport'],
    ['10-19', '-',           'Return to station'],
    ['10-20', 'LOCATION',    'What is your location?'],
    ['10-22', '-',           'Disregard'],
    ['10-23', 'STANDBY',     'Stand by'],
    ['10-25', '-',           'Can you meet?'],
    ['10-27', '-',           'Driver\'s license check'],
    ['10-28', '-',           'Vehicle registration check'],
    ['10-29', '-',           'Want / warrant check'],
    ['10-32', '-',           'Subject with gun / weapons'],
    ['10-33', '-',           'EMERGENCY — all units hold traffic'],
    ['10-50', 'TC',          'Traffic collision'],
    ['10-55', '-',           'Intoxicated driver'],
    ['10-70', '-',           'Fire alarm / fire'],
    ['10-76', 'EN ROUTE',    'En route / responding'],
    ['10-97', 'ON SCENE',    'Arrived / on scene'],
    ['10-98', '-',           'Assignment completed'],
    ['10-99', 'EMERGENCY',   'Officer emergency (triggers panic)'],
  ];

  const liveTen = (ctx.liveCodes ?? [])
    .filter((c) => /^10-/i.test(c.code ?? ''))
    .map((c) => [c.code, c.status_label ?? '-', c.description ?? '']);

  const tenRows = liveTen.length > 0 ? liveTen : hardcoded10Codes;

  if (liveTen.length > 0) {
    paragraph(ctx,
      `Live snapshot — ${liveTen.length} 10-codes pulled from this server's dispatch_codes table at generation time. Edit admin -> Dispatch Codes to change what appears here on the next guide download.`,
    );
  }

  table(ctx,
    ['Code', 'Status', 'Meaning'],
    tenRows,
    [2, 3, 6],
  );

  h2(ctx, 'Status Transitions');
  paragraph(ctx,
    'Units move through a predictable set of status values during a shift. The console enforces legal transitions: a unit cannot go from Off Duty directly to On Scene, for example — they must Log On first. The valid transitions are:',
  );
  bullet(ctx, 'Off Duty -> Available (unit logs on at start of shift).');
  bullet(ctx, 'Available -> Dispatched (assigned to a call).');
  bullet(ctx, 'Dispatched -> Enroute (unit acknowledged and is moving).');
  bullet(ctx, 'Enroute -> On Scene (arrived at location).');
  bullet(ctx, 'On Scene -> Available (call cleared, back in service).');
  bullet(ctx, 'Any in-service status -> Busy (temporarily engaged, not available).');
  bullet(ctx, 'Any in-service status -> Out of Service (meals, fuel, court, admin).');
  bullet(ctx, 'Out of Service / Busy -> Available (resumed in-service status).');
  bullet(ctx, 'Available -> Off Duty (unit logs off at end of shift).');

  paragraph(ctx,
    'The Dispatcher Brain timer-rule (Section 7) watches for stuck states — a unit in Dispatched for more than 90 seconds without an Enroute, or On Scene for more than 8 minutes without a status update. Both trigger spoken reminders to the dispatcher responsible for the call.',
  );

  h2(ctx, 'Signal Codes (Agency-Specific)');
  paragraph(ctx,
    'In addition to 10-codes, RMPG uses signal codes for operational categories that do not have standard 10-code equivalents. Signal codes are typed as "S" followed by a number and always spoken in full ("signal fifty").',
  );
  const hardcodedSignals: string[][] = [
    ['S-3',   'Shots fired'],
    ['S-10',  'Bomb threat'],
    ['S-20',  'Robbery in progress'],
    ['S-30',  'Burglary in progress'],
    ['S-40',  'Prowler'],
    ['S-50',  'Suicide attempt / threat'],
    ['S-60',  'Missing person'],
    ['S-70',  'Mental health subject'],
    ['S-99',  'Officer needs assistance — not life threatening'],
    ['S-100', 'Disturbance'],
  ];
  const liveSignals = (ctx.liveCodes ?? [])
    .filter((c) => /^s-/i.test(c.code ?? ''))
    .map((c) => [c.code, c.description ?? '']);
  const signalRows = liveSignals.length > 0 ? liveSignals : hardcodedSignals;

  table(ctx,
    ['Signal', 'Meaning'],
    signalRows,
    [2, 8],
  );

  calloutBox(ctx, 'Safety',
    '10-99 and Signal-3 (shots fired) are the two signals that MUST never be used casually. Saying either through the voice channel broadcasts an emergency to every workstation, plays the panic tone, clears the speak-queue of lower-priority items, and pages the on-call supervisor. False activations require an incident report and a supervisor conversation.',
    'warn',
  );

  h2(ctx, 'Looking Up a Code');
  paragraph(ctx,
    'If an officer says a code you do not recognize, three ways to look it up without interrupting radio traffic:',
  );
  bullet(ctx, 'Press F8, type "LE 29" (or whatever the code is), Enter. The lookup pops in the command line response area.');
  bullet(ctx, 'Help menu -> Quick Reference -> 10-Codes Reference. Opens a searchable popover.');
  bullet(ctx, 'Hover over any code chip in the unit roster — the tooltip shows meaning.');
}

function section4(ctx: GuideContext): void {
  title(ctx, '4. Safety Flags & Priority Levels');

  paragraph(ctx,
    'Priority and safety flags do two things: they tell responding officers what they are walking into, and they tell the CAD system how urgently to dispatch. Priority is a single P1-P4 level; safety flags are one or more tags that describe specific hazards. A call can have any combination of flags regardless of priority.',
  );

  drawPriorityPyramidDiagram(ctx);

  h2(ctx, 'Priority Levels');
  paragraph(ctx,
    'Every call must be assigned a priority. The system auto-populates based on incident type (e.g. "robbery in progress" defaults to P1; "vandalism report" defaults to P3) but the dispatcher always has final say and can override.',
  );
  table(ctx,
    ['Priority', 'Meaning', 'Typical Response', 'Color'],
    [
      ['P1', 'Emergency — immediate life or safety threat', 'Lights + siren, nearest unit, second unit coming',  'Red'],
      ['P2', 'Urgent — crime in progress or imminent',      'Respond promptly, no lights/siren unless needed',   'Orange'],
      ['P3', 'Routine — reported, delay acceptable',        'Standard response, closest available unit',         'Yellow'],
      ['P4', 'Cold — report only, no on-scene response',    'Phone report, deferred visit, or online report',    'Gray'],
    ],
    [2, 5, 5, 3],
  );

  h3(ctx, 'Priority Escalation & De-escalation');
  paragraph(ctx,
    'Priority can change during a call. A P3 welfare check that turns into a weapons threat upgrades to P1. A P1 robbery-in-progress where the suspect has clearly fled becomes P2 or P3 for the follow-up investigation. Use the PRI <call#> <level> command or the priority dropdown in the detail pane. Every priority change is audited with who changed it, when, and what it was before.',
  );
  paragraph(ctx,
    'Upgrade rules — err toward upgrading when in doubt:',
  );
  bullet(ctx, 'Caller reports weapons that were not initially mentioned -> upgrade to at least P2, P1 if weapons are currently displayed.');
  bullet(ctx, 'Caller reports active violence -> P1.');
  bullet(ctx, 'Caller reports they cannot safely stay on the phone -> P1 regardless of original nature.');
  bullet(ctx, 'Officer on scene requests upgrade -> immediately, no questions asked.');

  paragraph(ctx,
    'Downgrade rules — be cautious:',
  );
  bullet(ctx, 'Suspect has clearly fled and is no longer a threat -> P2 or P3 for investigation.');
  bullet(ctx, 'Call turns out to be a false alarm -> keep priority as-is until officers clear; then disposition as unfounded.');
  bullet(ctx, 'Caller changes story -> do NOT downgrade unilaterally. Update notes, keep priority, let officers investigate.');

  h2(ctx, 'Safety Flags — In Detail');
  paragraph(ctx,
    'Every call can carry one or more safety flags. Flags trigger Dispatcher Brain voice warnings to responding units (Section 7), add priority score, and become part of the permanent record. Flags are set at intake but can be added or corrected as new information comes in.',
  );

  h3(ctx, 'Weapons Involved');
  paragraph(ctx,
    'Triggers: caller mentions any firearm, knife, or other weapon on scene or involved in the incident. Also set when a subject has a documented weapons history at the address from prior calls.',
  );
  paragraph(ctx,
    'Required actions: notify the responding unit immediately (verbally and via flag). For firearms specifically, consider adding a second unit and positioning for tactical approach. If the caller reports the weapon is currently displayed or used, upgrade to P1.',
  );

  h3(ctx, 'Domestic Violence');
  paragraph(ctx,
    'Triggers: any call involving intimate partners, family members in the same household, or current/former dating partners with any physical, verbal, or emotional conflict. Also set for welfare checks on known DV victims.',
  );
  paragraph(ctx,
    'Required actions: two-unit response strongly recommended. Check prior call history at address for DV patterns. Brain will speak "approach with caution — domestic, weapons history on location" if history exists. Document injuries, visible weapons, presence of children, any statements that bear on protective-order violation. Utah mandatory-arrest law applies; the officer on scene decides but the dispatcher should have full history ready.',
  );

  h3(ctx, 'Felony in Progress');
  paragraph(ctx,
    'Triggers: armed robbery, burglary-in-progress, carjacking, kidnapping, sexual assault in progress, any other Class A or B felony currently occurring.',
  );
  paragraph(ctx,
    'Required actions: minimum two units, P1 priority. Consider perimeter units if suspect may flee. BOLO broadcast to neighboring agencies (SLCPD, UHP, Sandy PD, etc.) for any outbound directional info. Brain prompts "felony in progress, recommend second unit" automatically if only one unit is assigned.',
  );

  h3(ctx, 'Mental Health Crisis');
  paragraph(ctx,
    'Triggers: caller or subject exhibits confusion, disorientation, suicidal ideation, hallucinations, recent psychiatric history, or is off their medication with visible distress. Also set for welfare checks on subjects with known mental-health flags in Records.',
  );
  paragraph(ctx,
    'Required actions: request CIT (Crisis Intervention Team) trained officer when available. Request non-lethal staging — less-lethal tools (Taser, beanbag) ready but not deployed unless needed. EMS coordination for potential medical component. Brain says "mental health crisis — CIT response preferred, non-lethal staging" to remind responders.',
  );

  h3(ctx, 'Officer Safety Caution');
  paragraph(ctx,
    'Triggers: prior encounters at this address or with this subject resulted in resistance, assault on officer, weapons, or other documented safety issues. The system surfaces this flag automatically from historical call data at the address.',
  );
  paragraph(ctx,
    'Required actions: brief responding officer verbally on the specific caution — "officer-safety flag from 2025 call, subject threatened officer with knife". Details matter; a vague "be careful" is less useful than the specific prior incident number.',
  );

  h3(ctx, 'Vehicle Pursuit');
  paragraph(ctx,
    'Triggers: officer is actively pursuing a fleeing vehicle.',
  );
  paragraph(ctx,
    'Required actions: activate the pursuit banner on all workstations. Designate a supervisor to monitor. Log every direction, speed, and major intersection update in the notes in real time. Notify neighboring agencies. Prepare for termination criteria — supervisor decides, but you should have the information ready: speed, public risk, crime severity, weather, visibility. Document the termination reason immediately when pursuit ends, whether by apprehension, suspect flight, or supervisor termination.',
  );

  h3(ctx, 'Foot Pursuit');
  paragraph(ctx,
    'Triggers: officer is actively pursuing a fleeing subject on foot.',
  );
  paragraph(ctx,
    'Required actions: maintain continuous radio contact — foot pursuits are higher-risk than vehicle pursuits because officers are isolated from their radios. Track direction changes and cross streets. Dispatch a cover unit to the last known direction of travel. If pursuit enters a building or obstructed area, escalate immediately — this is when officers get hurt.',
  );

  h3(ctx, 'Hazmat');
  paragraph(ctx,
    'Triggers: chemical, biological, radiological, or explosive materials reported or suspected.',
  );
  paragraph(ctx,
    'Required actions: do not let officers approach until hazmat-trained responders clear. Establish upwind staging area. Contact local hazmat team (SLC Fire HazMat for most cases). Evacuate bystanders to safe distance. Call-taker should ask about smell, color, container markings — all are critical for hazmat identification.',
  );

  h3(ctx, 'Juvenile Involved');
  paragraph(ctx,
    'Triggers: any person under 18 is involved as victim, subject, witness, or reporting party.',
  );
  paragraph(ctx,
    'Required actions: follow juvenile-handling protocols. If a crime against a minor, incident report is mandatory. Do not release juvenile personal information over unsecured channels. Coordinate with School Resource Officer if incident is school-related. Note any parental or guardian notifications.',
  );

  h3(ctx, 'EMS / Medical');
  paragraph(ctx,
    'Triggers: any injury, unconsciousness, severe intoxication, mental-health with overdose risk, pregnancy complications, or caller specifically requests medical.',
  );
  paragraph(ctx,
    'Required actions: coordinate with EMS dispatch (separate radio). Give EMS the address, nature of medical, and any safety concerns (weapons on scene, combative subject). Request PD secure the scene before EMS enters when applicable.',
  );

  h2(ctx, 'Setting Flags After a Call Is Open');
  paragraph(ctx,
    'New information during a call frequently requires adding a flag. From the detail pane, use the flag chips to toggle on or off. Every change is audited. You can also use the command line:',
  );
  bullet(ctx, 'NT <call#> FLAG WEAPONS — adds a weapons flag AND creates a note documenting the source.');
  bullet(ctx, 'NT <call#> FLAG DV — adds a DV flag.');
  bullet(ctx, 'Multiple flags in one command: NT <call#> FLAG WEAPONS FLAG DV.');

  calloutBox(ctx, 'Policy — Flags Never Come Off',
    'Flags set on a call follow the call into the incident report and into the permanent history at the address. Never remove a safety flag to "clean up" a record — even if the original reason turned out to be unfounded, add a correcting note instead. Removed flags are auditable, and removing them without justification is a policy violation.',
    'warn',
  );
}

function section5(ctx: GuideContext): void {
  title(ctx, '5. F-Key Hotkeys');

  paragraph(ctx,
    'F-keys are the fastest way to drive the console. They work from anywhere in the dispatch screen unless a text field has focus — if a hotkey is not responding, press Escape to release focus from whatever input you are currently in, then try again.',
  );

  paragraph(ctx,
    'Memorizing the F-key row is the single highest-value training investment you can make. A dispatcher who knows F2-F7 by muscle memory will triage calls noticeably faster than one who hunts through menus. Print the quick-reference card at the end of this guide and tape it to the side of your monitor until the keys become automatic.',
  );

  drawFKeyboardDiagram(ctx);

  h2(ctx, 'Primary F-Keys');
  table(ctx,
    ['Key', 'Action', 'When to Use'],
    [
      ['F1',  'Shortcut overlay',      'Any time you forget a key. Highlights active shortcuts for the focused panel.'],
      ['F2',  'New Call',              'Phone rings and you need to open an intake form in under a second.'],
      ['F3',  'Dispatch Unit',         'Call is open and selected; assign the nearest available unit.'],
      ['F5',  'Set En Route',          'Unit acknowledged by radio and you need to set status without them logging in.'],
      ['F6',  'Set On Scene',          'Unit arrives and confirms by radio; starts the 8-minute welfare timer.'],
      ['F7',  'Clear Call',            'Call is resolved; prompts for disposition code.'],
      ['F8',  'Focus Command Line',    'Need to run a CAD verb (NC, CI, AS, etc.) — see Section 6.'],
      ['F9',  'Advanced Search',       'Records search across persons, vehicles, addresses, incidents.'],
      ['F10', 'BOLO Alert',            'Issue a broadcast alert for a suspect or vehicle.'],
      ['F11', 'Full Screen',           'Toggles browser full-screen — hides tabs and address bar for maximum real estate.'],
      ['F12', 'NCIC Query',            'Opens NCIC / records query panel for plates, persons, warrants.'],
    ],
    [2, 4, 7],
  );

  h2(ctx, 'Letter Hotkeys');
  paragraph(ctx,
    'Single-letter hotkeys are context-dependent: they activate only when no text input has focus. Press Escape first if a letter key seems to do nothing.',
  );
  table(ctx,
    ['Key', 'Action', 'Context'],
    [
      ['V',   'Open Voice Channel',     'Manual listen mode when brain is enabled — starts mic for command.'],
      ['T',   'Toggle Transcript Pane', 'Shows the drawer listing every spoken announcement with severity LEDs.'],
      ['N',   'New (context-sensitive)','On Dispatch page: new call. On Records: new record. On Incidents: new incident.'],
      ['?',   'Keyboard Shortcuts',     'Full shortcut help overlay. Same as F1 but works from modifier-free context.'],
      ['/',   'Focus Global Search',    'Jumps cursor to the top search bar. Esc returns focus to call list.'],
      ['Esc', 'Release Focus / Cancel', 'Unfocuses the current input. Cancels open dialogs. Returns to call list.'],
    ],
    [2, 4, 7],
  );

  h2(ctx, 'Navigation Hotkeys');
  paragraph(ctx,
    'Alt+number jumps between major modules without touching the mouse. These use the numeric row, not the numpad.',
  );
  table(ctx,
    ['Key', 'Destination'],
    [
      ['Alt+1', 'Dashboard'],
      ['Alt+2', 'Dispatch Console'],
      ['Alt+3', 'Map'],
      ['Alt+4', 'Records / Master Name Index'],
      ['Alt+5', 'Incidents'],
      ['Alt+6', 'Citations'],
      ['Alt+7', 'Reports'],
      ['Alt+8', 'Communications / BOLO'],
      ['Alt+9', 'Admin (admin role only)'],
    ],
    [2, 5],
  );

  h2(ctx, 'Focus Management');
  paragraph(ctx,
    'Three rules that save a lot of "why does my hotkey not work?" frustration:',
  );
  bullet(ctx, 'F-keys always work regardless of focus — they are global. If F-key is not responding, the browser may be intercepting it (F11 especially — press Esc to exit browser full-screen first).');
  bullet(ctx, 'Letter keys only work when no text input has focus. A call with the caller-name field open will swallow "N" as a letter instead of triggering "New".');
  bullet(ctx, 'Escape is the universal "release focus" key. Pressing Escape from any input returns focus to the parent panel, at which point letter hotkeys work again.');

  h2(ctx, 'Browser Shortcuts to Avoid');
  paragraph(ctx,
    'A few browser shortcuts conflict with dispatch actions or have side effects you do not want during a shift:',
  );
  bullet(ctx, 'Ctrl+W / Cmd+W — closes the browser tab. Easy to hit accidentally. Re-open with Ctrl+Shift+T but any unsaved work is lost.');
  bullet(ctx, 'Ctrl+Tab — switches browser tabs. Use Alt-number within RMPG Flex instead; stay on one tab.');
  bullet(ctx, 'Ctrl+R / Cmd+R — reloads the page. Safe and sometimes necessary, but reopens connections and loses map pan/zoom state.');
  bullet(ctx, 'Ctrl+Shift+R — hard reload. Use this when the page seems stuck or the cache is serving stale assets.');

  calloutBox(ctx, 'Tip',
    'If you are curious which shortcut is doing something, press F1 to open the overlay. It shows every active shortcut for whatever panel currently has focus, including those bound by the current page component. The overlay updates as you move focus between panels.',
  );
}

function section6(ctx: GuideContext): void {
  title(ctx, '6. CAD Command Line');

  paragraph(ctx,
    'The CAD command line is the dispatcher\'s power tool. Press F8 to focus it, type a verb followed by arguments, press Enter. The command line understands both the terse two-letter verbs below and full 10-codes. Most actions you can do through the GUI have a command-line equivalent that is two to five times faster once you know the syntax.',
  );

  paragraph(ctx,
    'Commands are case-insensitive — "nc domestic 123 main" works identically to "NC DOMESTIC 123 MAIN". Arguments are space-separated; quote values that contain spaces ("NC \\"open container\\" 123 main"). Press Tab to cycle autocomplete suggestions, Up/Down arrows to recall recent commands.',
  );

  h2(ctx, 'Call Management Commands');
  table(ctx,
    ['Verb', 'Syntax', 'Purpose'],
    [
      ['NC',  'NC <type> [location]',                 'New call for service'],
      ['CI',  'CI <call#>',                           'Select / show call info'],
      ['AS',  'AS <unit> <call#>',                    'Assign unit to call'],
      ['UN',  'UN <unit> <call#>',                    'Unassign unit from call'],
      ['ST',  'ST <unit> <status>',                   'Change unit status'],
      ['US',  'US <unit> <status>',                   'Update unit status (alias)'],
      ['CL',  'CL <call#> [disposition]',             'Clear call with disposition'],
      ['HD',  'HD <call#> [minutes]',                 'Hold call for N minutes'],
      ['HOLD','HOLD <call#> [minutes]',               'Alias for HD'],
      ['NT',  'NT <call#> <note>',                    'Append note to call'],
      ['PRI', 'PRI <call#> <P1..P4>',                 'Change priority'],
      ['TR',  'TR <call#> <to-dispatcher>',           'Transfer call ownership'],
    ],
    [2, 5, 6],
  );

  h3(ctx, 'Worked examples — Call Management');
  bullet(ctx, 'NC domestic 123 Main St — opens new-call form pre-filled with type "domestic" at 123 Main Street.');
  bullet(ctx, 'CI 2026-CFS-00142 — selects that call in the list and populates the detail pane.');
  bullet(ctx, 'CI 142 — shorthand: system expands to the most recent matching call.');
  bullet(ctx, 'AS 3A 142 — assigns unit 3-Adam to call 142. Works on the selected call if you omit the number.');
  bullet(ctx, 'ST 3A 10-97 — sets unit 3-Adam to "On Scene" via the 10-code.');
  bullet(ctx, 'NT 142 caller states suspect has left, heading north on State St — appends note.');
  bullet(ctx, 'CL 142 Report Taken — clears call 142 with disposition.');
  bullet(ctx, 'HD 142 30 — holds call 142 for 30 minutes (useful for scheduled follow-ups).');

  h2(ctx, 'Broadcast / Alert Commands');
  table(ctx,
    ['Verb', 'Syntax', 'Purpose'],
    [
      ['BO',  'BO <description>',                     'Broadcast BOLO (be on the lookout)'],
      ['QB',  'QB <beat>',                            'Query calls in a beat'],
      ['AA',  'AA <message>',                         'All-units announcement (non-emergency)'],
      ['EM',  'EM <message>',                         'Emergency all-units broadcast (P1-level tone)'],
    ],
    [2, 5, 6],
  );

  h2(ctx, 'Query / Lookup Commands');
  paragraph(ctx,
    'Lookups are non-destructive — they fetch and display information without changing any records. Use them liberally during a traffic stop or when an officer radios in for information.',
  );
  table(ctx,
    ['Verb', 'Syntax', 'Purpose'],
    [
      ['QP',  'QP <name>',                            'Query person records (criminal + field history)'],
      ['QH',  'QH <name>',                            'Query person history (alias of QP)'],
      ['QV',  'QV <VIN or tag>',                      'Query vehicle by VIN or license plate'],
      ['QW',  'QW <name>',                            'Query active warrants'],
      ['QT',  'QT <tag> [state]',                     'Traffic-stop query — plate + state for ownership + warrants'],
      ['PR',  'PR <address>',                         'Premise alerts for address (prior call history, flags)'],
      ['PI',  'PI <property-id>',                     'Property info by ID or address'],
      ['DU',  'DU <unit>',                            'Duty / shift info for unit (officer assigned, times)'],
      ['FI',  'FI <person_name>',                     'Start Field Interview card for the named person'],
      ['LE',  'LE <code>',                            '10-code lookup (returns meaning + category)'],
    ],
    [2, 5, 6],
  );

  h3(ctx, 'Worked examples — Queries');
  bullet(ctx, 'QT 8IDA745 UT — queries Utah plate 8-Ida-745 for registration, owner, warrants, prior stops.');
  bullet(ctx, 'QP Doe, John 1985-03-15 — queries person by name + DOB (reduces false matches).');
  bullet(ctx, 'QW Smith — queries active warrants for subjects named Smith. Results include warrant number, bail, court.');
  bullet(ctx, 'PR 123 Main St — returns premise alerts (prior DV flag, officer safety caution) for the address.');
  bullet(ctx, 'LE 29 — returns "10-29: want/warrant check".');
  bullet(ctx, 'FI Jones, Mary — opens a Field Interview card pre-filled with subject name.');

  h2(ctx, 'Status & Informational');
  table(ctx,
    ['Verb', 'Purpose'],
    [
      ['STATUS',   'Current dispatcher workstation status (active calls, assigned units)'],
      ['CHECK',    'Call count + unit metrics overview (pending, active by priority, units by status)'],
      ['ETA',      'Estimated time of arrival for assigned unit on selected call'],
      ['WEATHER',  'Current weather for the operational zone (via local feed)'],
      ['TIME',     'System time (Mountain Time) with UTC offset'],
      ['ACK',      'Acknowledge (equivalent to 10-4)'],
      ['HANDOFF',  'Open shift-handoff notes for read/write'],
    ],
    [2, 6],
  );

  h2(ctx, 'Administrative Commands');
  paragraph(ctx,
    'These require admin or supervisor role and are used for corrections, system checks, and operational oversight.',
  );
  table(ctx,
    ['Verb', 'Syntax', 'Purpose'],
    [
      ['ML',   'ML <unit> <start|end> <mi>',          'Log mileage at start or end of shift'],
      ['OR',   'OR <call#> <field> <value>',          'Override a call field (audited, supervisor only)'],
      ['UNDO', 'UNDO <call#>',                        'Reverse the last change to a call (supervisor only)'],
      ['AUDIT','AUDIT <call#>',                       'Show full audit log for a call'],
    ],
    [2, 5, 6],
  );

  h2(ctx, 'Command Chaining & Autocomplete');
  paragraph(ctx,
    'A few patterns that save keystrokes on common sequences:',
  );
  bullet(ctx, 'Up arrow recalls recent commands. Keep pressing Up to go further back; Ctrl+R starts a reverse search if your recent history is long.');
  bullet(ctx, 'Tab completes verbs and common arguments. "N<Tab>" cycles through NC, NT. "ST 3A 10<Tab>" cycles through 10-4, 10-6, 10-7, etc.');
  bullet(ctx, 'Selecting a call first makes subsequent commands shorter: click a call, then "ST 3A 10-97" works on the selected call without needing the number.');
  bullet(ctx, 'Use the Up-arrow recall to repeat the last command with edits — great for updating multiple units to the same status in quick succession.');

  h2(ctx, 'Common Typos to Avoid');
  bullet(ctx, 'CL vs CI — CL clears a call (destructive), CI selects it (harmless). When in doubt, select first to verify you have the right call.');
  bullet(ctx, 'PRI requires a P1-P4 value, not a number. "PRI 142 1" fails; "PRI 142 P1" works.');
  bullet(ctx, 'Unit call signs: use the canonical form. "3A" and "3-Adam" both work; "3Adam" without separator does NOT match.');
  bullet(ctx, 'Plates: omit dashes and spaces ("8IDA745" not "8-IDA-745"). State is optional but recommended.');

  calloutBox(ctx, 'Error Messages',
    'The command line returns red text for errors, green for success. Errors always tell you the problem: "Unit 9Z not found", "Call 999 not found", "Usage: NC <type> [location]". Read the error carefully — the system is quite specific about what went wrong.',
  );
}

function section7(ctx: GuideContext): void {
  title(ctx, '7. Voice Features (Dispatcher Brain)');

  paragraph(ctx,
    'RMPG Flex includes a Dispatcher Brain — an optional layer that speaks alerts, coaching, and event notifications through a neural voice. The brain was built in four phases and the features described below are all live in production. Every feature is opt-in per user, default off, configurable in User Profile -> Voice.',
  );

  paragraph(ctx,
    'The design philosophy: the brain should be an attentive second dispatcher who never gets tired. It speaks up when safety flags are relevant, reminds you of overdue checks, and announces events you might have missed — but it never barks, never repeats itself, and always defers to human judgment.',
  );

  drawBrainPipelineDiagram(ctx);

  h2(ctx, 'Voice Persona');
  paragraph(ctx,
    'Voice persona controls every spoken line in the system, not just the brain. The Phase 1 voice work applies to standard dispatch announcements too — your new-call chimes and priority alerts will use whatever voice you pick here.',
  );

  h3(ctx, 'The four curated voices');
  bullet(ctx, 'Female Calm (Jenny) — default. Measured, slightly warm. Easiest to listen to across an 8-hour shift.');
  bullet(ctx, 'Female Crisp (Aria) — sharper articulation, slightly faster natural pace. Preferred by dispatchers who find Jenny too soft to hear over radio traffic.');
  bullet(ctx, 'Male Baritone (Guy) — lower frequency, authoritative. Some dispatchers report it cuts through headphone noise better.');
  bullet(ctx, 'Male Tactical (Davis) — crisp male voice with a harder edge. Good for tactical environments; can feel abrupt in quiet periods.');

  paragraph(ctx,
    'There is no "right" voice. Try each with the Preview button and keep whichever you find least fatiguing after thirty minutes of listening. You can change anytime; the choice follows your user across workstations because it is stored on the server.',
  );

  h3(ctx, 'Rate & pitch');
  bullet(ctx, 'Rate: 0.7x to 1.4x in 0.05 steps. Default 1.0 (neutral). Urgent alerts automatically get a +10% bump on top of your baseline.');
  bullet(ctx, 'Pitch: -20 to +20 Hz in 1-unit steps. Default 0. Urgent alerts add +5 Hz. Pitch offsets are subtle — try -10 to get a slightly deeper male voice, +5 for a slightly brighter female voice.');
  bullet(ctx, 'Both are real-time previewable. Adjust, press Preview, adjust again. Once you commit, the PUT request saves to your user record within a second.');

  h3(ctx, 'Terseness modes');
  paragraph(ctx,
    'Terseness controls how much the system says about a new call. Different dispatchers prefer different verbosity.',
  );
  paragraph(ctx,
    'Example spoken output for a new P1 domestic at 123 Main Street, Delta-2 beat 14, unit 3-Adam assigned:',
  );
  bullet(ctx, 'Narrative (full prose): "New call, priority one, domestic disturbance at 123 Main Street, apartment 4B, zone Delta-2 beat 14. Suspect is a white male, 30s, black hoodie. Unit 3-Adam assigned."');
  bullet(ctx, 'Standard (CAD shorthand): "P1 domestic, 123 Main, Delta-2-14, 3-Adam." — default, preserves existing cadence.');
  bullet(ctx, 'Terse (minimum): "P1 domestic, 123 Main, 3-Adam." — fastest, skips zone and detailed description.');

  paragraph(ctx,
    'Dispatchers working busy shifts often prefer Terse; trainees and those working quieter beats often prefer Narrative so they absorb context. Supervisors may standardize the mode for their shift — if your agency has a policy, follow it.',
  );

  h2(ctx, 'Transcript Drawer');
  paragraph(ctx,
    'The transcript drawer is a persistent record of every spoken announcement. Press T anywhere in the app to toggle it.',
  );
  bullet(ctx, 'Severity color LEDs: red = major (officer down, panic), amber = moderate (coaching, approach warning), green = minor (event notice, status).');
  bullet(ctx, 'Timestamps are shown in Mountain Time, HH:MM:SS.');
  bullet(ctx, 'The drawer holds the 100 most recent entries — older ones roll off as new arrive.');
  bullet(ctx, 'Hidden ARIA live regions mirror every announcement to screen readers using aria-live="polite" for normal severity and aria-live="assertive" for major.');
  bullet(ctx, 'Use it for shift review — "what exactly did the brain say at 14:23?" — or for audit purposes when an officer asks what you were told.');

  h2(ctx, 'Dispatcher Brain (Master Toggle)');
  paragraph(ctx,
    'Once you toggle "Dispatcher Brain (Beta)" on in the Voice tab and reload the page, the brain activates and begins speaking proactively across six rule categories.',
  );

  h3(ctx, 'Event rules (minor severity)');
  paragraph(ctx,
    'These fire when a corresponding database mutation is broadcast on the WebSocket. You hear them for every event across every workstation unless cooldown suppresses a repeat.',
  );
  bullet(ctx, 'Citation issued — "Citation RN-26-0142 issued by 4-Bravo, $85 fine."');
  bullet(ctx, 'Incident opened — "Incident RN-26-0301 opened from call CN-26-0457."');
  bullet(ctx, 'Warrant entered (moderate severity) — "New warrant on Smith John, felony, $50,000 bail."');
  bullet(ctx, 'Evidence logged — "Evidence tag E-26-0089 logged for case 26-0301."');
  bullet(ctx, 'Arrest booked (moderate severity) — "Arrest booked: Doe John, felony theft, by 4-Bravo."');
  bullet(ctx, 'Leave approved — "Leave request approved for Smith."');

  h3(ctx, 'Coaching rules (moderate severity)');
  paragraph(ctx,
    'These fire when call flags and context suggest an officer needs a reminder. Each has a 5-10 minute cooldown keyed to the call number, so a call updating repeatedly does not spam the same warning.',
  );
  bullet(ctx, 'DV approach warning — "Approach with caution — domestic, weapons history on location." Fires on any call with the DV flag.');
  bullet(ctx, 'Felony backup suggest — "Felony in progress, recommend second unit." Fires when felony_in_progress is flagged AND fewer than 2 units are assigned.');
  bullet(ctx, 'Mental-health protocol — "Mental health crisis — CIT response preferred, non-lethal staging." Fires on any call with the MH flag.');

  h3(ctx, 'Timer-triggered rules (moderate severity)');
  paragraph(ctx,
    'A 30-second background timer checks for time-dependent conditions:',
  );
  bullet(ctx, 'Overdue status check — "3-Adam, status check, 8 minutes on scene." Fires once per call, 5-minute cooldown, when your unit has been on-scene for 8+ minutes without a status update. Useful welfare-check prompt but never a replacement for human attention.');

  h3(ctx, 'Geofence rules (minor severity)');
  bullet(ctx, 'Geofence breach — "3-Adam is outside assigned beat Delta-2." Fires when a unit\'s GPS position is identified as outside the beat assigned to that unit. Requires the unit to have an assigned_beat configured by admin. 3-minute cooldown per unit.');

  h2(ctx, 'Cooldowns & Rate Limiting');
  paragraph(ctx,
    'The brain has three layers of noise control so it never becomes a distraction:',
  );
  bullet(ctx, 'Per-rule entity cooldown: the same rule for the same call/unit/citation does not repeat within its cooldown window. A DV warning speaks once per call, not every time the call updates.');
  bullet(ctx, 'Global non-major rate limit: at most one non-major utterance every 6 seconds. Coaching and event rules queue up and drain one at a time with the gap; major alerts preempt.');
  bullet(ctx, 'Severity preemption: a major-severity item jumps to the front of the queue and clears any pending lower-severity items. Officer-down always beats "citation issued".');

  h2(ctx, 'Conversational Queries');
  paragraph(ctx,
    'With the brain enabled and voice channel active (press V to open the microphone manually, or enable auto-listen in Voice settings), you can speak queries and the brain responds. The referent resolver rewrites pronouns and deictics using conversational context.',
  );

  h3(ctx, 'Working query patterns');
  bullet(ctx, '"Tell me more about that call" — speaks a narrative summary of the last-mentioned call. "That" resolves to whichever call is currently in context.');
  bullet(ctx, '"Describe call CN-26-0457" — explicit form; speaks the narrative regardless of context.');
  bullet(ctx, '"Who is assigned to that call?" — speaks the assigned unit.');
  bullet(ctx, '"Who\'s on CN-26-0457?" — casual form of the same query.');
  bullet(ctx, '"What is the status of that call?" — speaks the call\'s current status and elapsed time.');

  h3(ctx, 'Ambiguity handling');
  paragraph(ctx,
    'If you use a pronoun or deictic with no prior context (e.g. "tell me about that call" as the first thing you say after a fresh session), the brain cannot resolve what "that" refers to. Instead of guessing, it asks:',
  );
  bullet(ctx, '"Which call did you mean?" — with the mic re-opened for four seconds so you can answer with a call number.');
  bullet(ctx, '"Which person did you mean?" — when "him" or "the subject" appears without a prior person reference.');
  bullet(ctx, '"Which unit did you mean?" — when "that unit" is unresolvable.');

  paragraph(ctx,
    'The resolver supports: "that call" / "this call" / "the call", "that location" / "the address", "him" / "her" / "the subject" / "that person", "that unit" / "the unit", "that plate" / "the plate". Patterns are case-insensitive but preserve the rest of your utterance\'s case.',
  );

  h2(ctx, 'When the Brain Speaks vs. When It Stays Quiet');
  paragraph(ctx,
    'Two rules of thumb that help predict brain behavior:',
  );
  bullet(ctx, 'The brain speaks the FIRST time a condition is true and stays quiet during the cooldown even if the condition remains true. DV approach fires on the first update of a DV call, not every update.');
  bullet(ctx, 'The brain speaks as soon as it can — it does not batch or summarize. If two events fire within a second, you hear both back-to-back with the 6-second gap between non-major items.');

  calloutBox(ctx, 'Rollback',
    'If brain output ever becomes distracting on a live shift, turn it off in your Voice settings — the change takes effect on next page load. Admin can force it off globally by clearing voice_brain_enabled for every user in the database. The flag exists specifically so a bad rule or a misbehaving deploy can be silenced without redeploying code.',
  );

  h2(ctx, 'Privacy & Audit');
  paragraph(ctx,
    'Every spoken line appears in the transcript drawer and, for mutating voice commands, an audit log entry. The referent resolver logs every rewrite so a supervisor reviewing a shift can see exactly what "that call" was resolved to before a command fired. There is no hidden state — if the brain did something, you can reconstruct why.',
  );

  paragraph(ctx,
    'Voice audio itself is not recorded or persisted by default. The hybrid STT pipeline uses the browser\'s Web Speech API (local, no audio leaves the machine) in parallel with a server-side Whisper endpoint for fallback transcription. Whisper audio is processed in memory and discarded; only the resulting text enters the audit log.',
  );
}

function section8(ctx: GuideContext): void {
  title(ctx, '8. Common Workflows');

  paragraph(ctx,
    'Every dispatcher develops patterns for routine calls. This section documents agency-preferred workflows for fifteen of the most common dispatch scenarios. Treat them as starting points — the facts of each call may require deviation, but these patterns cover the typical case.',
  );

  h2(ctx, 'Call Intake Workflows');

  h3(ctx, '911 transfer (emergency)');
  bullet(ctx, 'Open new call (F2) as soon as the transfer announcement begins — do not wait for full details.');
  bullet(ctx, 'Paste caller info from the 911 transfer. Verify the callback number by reading it back to the caller.');
  bullet(ctx, 'Set priority based on reported facts — P1 for any in-progress violence, active medical with unconsciousness, or imminent threat to life.');
  bullet(ctx, 'Flag weapons / DV / MH / hazmat as the caller mentions them. These upgrade the brain\'s response even if you forget to increase priority.');
  bullet(ctx, 'Save -> dispatch nearest available unit (F3). Second unit on P1.');
  bullet(ctx, 'Stay on the line with the caller. Append notes continuously — caller movement, suspect activity, new information — until officers are on-scene.');
  bullet(ctx, 'Relay information to responding officers every 30-60 seconds during active calls. Silence from dispatch implies "nothing new" which can miss updates.');

  h3(ctx, 'Non-emergency phone call');
  bullet(ctx, 'Most non-emergency calls come in on the business line, not 911. Priority defaults to P3 or P4 unless facts escalate.');
  bullet(ctx, 'Still open a call record (F2). Never take a complaint verbally without documenting.');
  bullet(ctx, 'Get caller name, phone, and enough detail that an officer can follow up even if the caller cannot stay on the line.');
  bullet(ctx, 'Ask whether they want an officer to call, visit, or whether the online report option is appropriate (for P4 cold reports like vandalism with no suspect, lost property, etc.).');

  h3(ctx, 'Online report intake');
  bullet(ctx, 'When an online report comes in, it appears as a pending call with source="online".');
  bullet(ctx, 'Review for completeness. Online reports often lack detail — call the reporting party if anything critical is missing.');
  bullet(ctx, 'If the report describes an in-progress or high-priority incident, upgrade priority and dispatch immediately — people sometimes file online when they should have called 911.');

  h2(ctx, 'Multi-Unit Response Workflows');

  h3(ctx, 'Multi-unit response');
  bullet(ctx, 'Dispatch primary unit first (F3).');
  bullet(ctx, 'Use AS <unit> <call#> to add each additional unit, or click Dispatch again on the detail pane.');
  bullet(ctx, 'Assign roles verbally if not obvious — "3-Adam primary, 3-Bravo contact, 3-Charlie cover".');
  bullet(ctx, 'Track every unit\'s on-scene time; if one is significantly late, radio check.');

  h3(ctx, 'Mutual aid from another agency');
  bullet(ctx, 'Mutual-aid responders (SLCPD, UHP, Sandy PD, etc.) are not in your unit roster. Create a note documenting their response ("SLCPD 3A5 on scene 14:23").');
  bullet(ctx, 'Communicate through their dispatch, not directly. Their dispatcher is your counterpart.');
  bullet(ctx, 'Document any mutual-aid assistance clearly for after-action review and any cost-sharing obligations.');

  h3(ctx, 'EMS coordination');
  bullet(ctx, 'EMS has their own CAD. You coordinate, not dispatch.');
  bullet(ctx, 'Give EMS dispatch the address, nature of medical, and any safety concerns (weapons, combative subject, unsecured scene).');
  bullet(ctx, 'For scene safety, PD should be on-scene before EMS enters for any call with weapons or violence. "Stage EMS at [cross street] until scene is secure" is a common phrase.');

  h3(ctx, 'Fire coordination');
  bullet(ctx, 'Fire has their own CAD too. Coordinate on structure fires, vehicle fires with possible fatality, hazmat, rescue operations.');
  bullet(ctx, 'Your responsibility during a joint response is traffic control and scene security around the fire operation.');

  h2(ctx, 'Tactical Workflows');

  h3(ctx, 'Vehicle pursuit');
  bullet(ctx, 'Officer initiates pursuit over radio. Acknowledge immediately.');
  bullet(ctx, 'Set the pursuit flag on the call — activates pursuit banner on every workstation.');
  bullet(ctx, 'Designate a supervisor to monitor in real time. Notify them by name.');
  bullet(ctx, 'Track continuously: direction of travel, speed, major intersections, description of fleeing vehicle, number of occupants, any violations observed.');
  bullet(ctx, 'Broadcast BOLO (BO command) with description to neighboring agencies as pursuit crosses jurisdictions.');
  bullet(ctx, 'Prepare termination criteria: speed, weather, public risk, crime severity. Supervisor decides to terminate; document the exact moment and reason.');
  bullet(ctx, 'Termination outcomes: apprehension, suspect escape, agency termination, traffic termination (unit loses line-of-sight safely). Document which and why.');

  h3(ctx, 'Foot pursuit');
  bullet(ctx, 'Highest-risk pursuit type — officer isolated from vehicle and radio.');
  bullet(ctx, 'Dispatch cover unit IMMEDIATELY to last known direction of travel.');
  bullet(ctx, 'Maintain continuous radio contact. Ask "status?" every 30 seconds until officer either catches up with suspect, loses sight, or requests cover.');
  bullet(ctx, 'If pursuit enters a building, confined space, or obstructed area, escalate to supervisor and request additional units.');
  bullet(ctx, 'Document exit point (direction suspect fled from officer) for search grid planning.');

  h3(ctx, 'Officer requests cover / backup');
  bullet(ctx, 'Treat any cover request as P1 until proven otherwise. Dispatch nearest available unit with lights and siren.');
  bullet(ctx, 'Ask the requesting officer whether they need silent approach (no lights/siren) or full emergency response — tactical situations may require silent.');
  bullet(ctx, 'If officer voice sounds stressed, elevated, or signals distress, assume worst case: dispatch multiple units and notify supervisor.');

  h3(ctx, 'Officer down / 10-99 / Signal 3');
  bullet(ctx, 'Absolute highest priority. Every available unit responds immediately.');
  bullet(ctx, 'Broadcast all-units emergency (EM command or voice "officer down" / "ten-ninety-nine").');
  bullet(ctx, 'Request EMS simultaneously — do not wait for scene security.');
  bullet(ctx, 'Notify SLCPD and UHP if within their response radius.');
  bullet(ctx, 'Pull up the officer\'s last known GPS position on the map and keep the map pane visible.');
  bullet(ctx, 'Do NOT clear the call until the officer confirms 10-4 on their own radio, in their own voice.');
  bullet(ctx, 'Notify command staff and the on-call supervisor immediately.');

  h3(ctx, 'Active shooter');
  bullet(ctx, 'P1, every unit responds.');
  bullet(ctx, 'Establish incident command radio channel — supervisor becomes IC.');
  bullet(ctx, 'Broadcast description, last known location, direction of movement on primary channel.');
  bullet(ctx, 'Activate school / business emergency notification if applicable.');
  bullet(ctx, 'Coordinate with SLCPD SWAT and tactical mutual-aid units.');
  bullet(ctx, 'Evacuate surrounding area — establish perimeter.');
  bullet(ctx, 'Document everything in real time; this call will be reviewed extensively.');

  h2(ctx, 'Routine Workflows');

  h3(ctx, 'Traffic stop');
  bullet(ctx, 'Officer calls in stop: plate, location, reason. Acknowledge with 10-4.');
  bullet(ctx, 'Run QT <plate> [state] automatically — return registration, owner, warrants to officer.');
  bullet(ctx, 'If plate returns warrants or prior officer-safety caution, notify officer BEFORE they approach the vehicle.');
  bullet(ctx, 'Start the traffic-stop timer — officers should update status every 5-10 minutes during a stop.');
  bullet(ctx, 'If officer does not update in 10 minutes, radio check.');

  h3(ctx, 'Welfare check');
  bullet(ctx, 'Intake: who is being checked, why the concern, where, any medical / mental-health history.');
  bullet(ctx, 'Run PR <address> — premise alerts may reveal prior MH flags, weapons history, DV.');
  bullet(ctx, 'Dispatch available unit. If history suggests risk, dispatch two.');
  bullet(ctx, 'Document outcome: subject contacted and well, subject contacted with concerns (EMS or MH referral), no contact (leave a note), crime discovered, subject deceased.');

  h3(ctx, 'BOLO broadcast');
  bullet(ctx, 'Use BO command or File -> New -> BOLO Alert.');
  bullet(ctx, 'Include: subject/vehicle description, direction of travel, last seen time + location, reason for BOLO, officer-safety notes (armed, violent, known to resist).');
  bullet(ctx, 'BOLO broadcasts to every workstation AND to neighboring agencies via inter-agency message.');
  bullet(ctx, 'Cancel the BOLO when the subject is apprehended or the incident resolves — stale BOLOs create confusion.');

  h3(ctx, 'Warrant service');
  bullet(ctx, 'Unit requests to serve a warrant — check the warrant record for bail, charges, officer-safety notes, court requirements.');
  bullet(ctx, 'For felony warrants or warrants with weapons history, recommend two-unit response.');
  bullet(ctx, 'If subject is arrested, link the arrest to the warrant record (WRN command from the arrest form).');
  bullet(ctx, 'If subject is not there or not the person named, document attempt and outcome; warrant remains active.');

  h3(ctx, 'Welfare check on overdue unit');
  bullet(ctx, 'Brain speaks overdue-status warning at 8 minutes. Do not wait — respond to your own awareness first.');
  bullet(ctx, 'Radio the unit on their channel: "3-Adam, status check."');
  bullet(ctx, 'No response within 2 minutes -> dispatch cover unit to last known location AND escalate to supervisor.');
  bullet(ctx, 'Log every check attempt as a note on the call, with timestamps.');
  bullet(ctx, 'If unit responds and is fine, confirm status with them explicitly ("10-4, continuing investigation, will update in 10").');

  h3(ctx, 'Shift handoff');
  bullet(ctx, 'Start 10 minutes before end of shift. Do not rush.');
  bullet(ctx, 'Walk through each active call with the incoming dispatcher — pending, in progress, unit assignments, any notable flags.');
  bullet(ctx, 'Use the Shift Handoff Notes field (F8 -> HANDOFF command) for asynchronous handoffs or notes that do not belong on a specific call.');
  bullet(ctx, 'Verify every on-scene unit has an entry timestamp so incoming dispatcher knows the clock and can anticipate overdue checks.');
  bullet(ctx, 'Do not log off until the incoming dispatcher has acknowledged and taken over. Both of you should confirm verbally.');
}

function section9(ctx: GuideContext): void {
  title(ctx, '9. Troubleshooting');

  paragraph(ctx,
    'When the console misbehaves, the fix is almost always one of four things: refresh the page, clear the browser cache, switch to another workstation, or page the on-call admin. This section walks through specific symptoms, their likely causes, and the fastest fix.',
  );

  h2(ctx, 'Connectivity & Sync');

  h3(ctx, 'WebSocket disconnected (status bar shows red)');
  paragraph(ctx,
    'Auto-reconnect runs every 3 seconds, backing off to a maximum of 30 seconds between retries. Up to 50 retries are attempted (roughly 25 minutes). If it does not recover on its own:',
  );
  bullet(ctx, 'Help -> System Status -> Reconnect.');
  bullet(ctx, 'Ctrl+R / Cmd+R to reload the page.');
  bullet(ctx, 'If the page itself will not load, move to the next workstation immediately and notify the on-call admin.');
  bullet(ctx, 'Your work is not lost — the server is the source of truth and has everything you committed. Queued offline writes replay on reconnect.');

  h3(ctx, 'Updates not appearing on my screen but other dispatchers see them');
  paragraph(ctx,
    'Your WebSocket is half-disconnected — still connected enough to not trigger the reconnect banner but not receiving broadcasts. This rarely happens but is distinctive. Force-reload (Ctrl+Shift+R) to rebuild the socket.',
  );

  h3(ctx, 'I can see calls but cannot save changes');
  paragraph(ctx,
    'Your session token may have expired or your role changed. Check top-right for your user badge — if it shows "logged out" reload and log back in. If still failing, logout via Help menu and log back in to force a fresh token.',
  );

  h2(ctx, 'GPS & Mapping');

  h3(ctx, 'Unit GPS not updating');
  bullet(ctx, 'Check unit\'s device has GPS permission granted in the browser/app.');
  bullet(ctx, 'Desktop workstations use WiFi geolocation which is less accurate than phone GPS and updates less often. Units on a mobile MDT or phone app will have fresher positions.');
  bullet(ctx, 'The server prefers higher-priority sources — a desktop sample will not overwrite a recent mobile sample. If desktop shows stale but mobile is fresh, the server may be ignoring the desktop update on purpose.');
  bullet(ctx, 'If a unit genuinely has no GPS, use ST <unit> command and location notes in the call instead of relying on the map.');

  h3(ctx, 'Map shows no units');
  paragraph(ctx,
    'All units have stale GPS (>10 minutes old) and have been filtered out by the freshness layer. Toggle "Show stale units" in the map controls, or investigate why the fleet is not reporting — dispatch check-in over radio.',
  );

  h3(ctx, 'Map tiles not loading');
  paragraph(ctx,
    'The offline CartoDB dark_matter tile layer is served from your local disk cache via service worker. If tiles are blank, the cache may be empty or corrupted. Admin can reseed by visiting Admin -> Tiles -> Reseed. In the meantime, the Google Maps base layer should work as fallback — verify via the map layer selector.',
  );

  h2(ctx, 'Voice');

  h3(ctx, 'Voice not working at all');
  bullet(ctx, 'Confirm master sound toggle (speaker icon in the status bar — click to toggle).');
  bullet(ctx, 'Confirm voice-alerts toggle in User Profile -> Voice.');
  bullet(ctx, 'Test with the Preview button in the Voice tab — if that is silent, check system audio output and browser audio permission.');
  bullet(ctx, 'If Edge TTS is unreachable (server issue), the system falls back to browser SpeechSynthesis automatically. The voice will sound different but will still announce.');
  bullet(ctx, 'If neither works, your browser may be blocking audio autoplay. Click anywhere on the page to grant interaction-based audio permission, then retry.');

  h3(ctx, 'Voice speaks wrong name or pronunciation');
  paragraph(ctx,
    'Edge TTS sometimes mispronounces unusual names or street names. Override by adding a custom pronunciation in Admin -> TTS -> Custom Words (admin only). For one-off lines, spell phonetically in the note ("Nguyen (NG-WEN)").',
  );

  h3(ctx, 'Dispatcher Brain is too chatty / not chatty enough');
  bullet(ctx, 'Too chatty: turn off Dispatcher Brain in Voice settings. Your standard dispatch announcements keep working.');
  bullet(ctx, 'Not chatty enough: confirm Dispatcher Brain toggle is on AND terseness is not set to Terse (which suppresses some coaching).');
  bullet(ctx, 'Specific missing rule: check the transcript drawer (T key) to see whether the rule fired but was suppressed by cooldown.');

  h3(ctx, 'Voice command (speaking to dispatcher) not working');
  bullet(ctx, 'Confirm brain is enabled AND voice channel is set to Manual listen mode (V key opens mic).');
  bullet(ctx, 'Check browser microphone permission. Chrome shows a mic icon in the address bar when permission is granted.');
  bullet(ctx, 'Speak clearly and include the full reference — "tell me about call CN-26-0457" works more reliably than fast slang.');
  bullet(ctx, 'If the brain always says "which call did you mean?", you may not have a conversational context yet — mention a call number explicitly in your first utterance to seed the resolver.');

  h2(ctx, 'Call Management');

  h3(ctx, 'Call missing from list');
  bullet(ctx, 'Check filter chips (pending / active / archived) at top of call list — a stray filter setting hides calls.');
  bullet(ctx, 'Use CI <call#> to jump directly — bypasses filters.');
  bullet(ctx, 'If the call was created by another dispatcher and should be visible to you, your role may not have permission. Check with a supervisor.');
  bullet(ctx, 'If truly missing, Admin -> Audit Log will show any deletion record.');

  h3(ctx, 'Cannot assign a unit');
  bullet(ctx, 'Unit may be off-duty (logged off or status = off_duty). Log the unit on first or pick another unit.');
  bullet(ctx, 'Call status may not allow assignment (e.g. archived). Use CI to verify call status.');
  bullet(ctx, 'Unit may already be assigned to another call. Check the unit\'s row in the roster.');

  h3(ctx, 'Wrong disposition saved');
  paragraph(ctx,
    'Dispositions cannot be edited after clear, by design — the audit trail must reflect what was actually recorded at the time. Open the archived call from Records, add a correction note explaining the actual outcome, and flag for supervisor review. The supervisor can add a supervisor-override note if formal correction is required.',
  );

  h3(ctx, 'Duplicate call (same incident reported twice)');
  bullet(ctx, 'Select both calls.');
  bullet(ctx, 'Use the Merge button in the detail pane header (supervisor only).');
  bullet(ctx, 'The older call absorbs the newer; both audit trails are preserved.');
  bullet(ctx, 'Do NOT just clear the duplicate with "Cancelled by Caller" — it loses the link. Merge preserves the relationship.');

  h2(ctx, 'Browser & Performance');

  h3(ctx, 'Console feels slow or laggy');
  bullet(ctx, 'First suspect: too many browser tabs open. Close everything except RMPG Flex.');
  bullet(ctx, 'Check CPU usage via Task Manager / Activity Monitor. If Chrome is at 100%, reload the page — a memory leak in the browser can accumulate over a long shift.');
  bullet(ctx, 'Clear browser cache (Ctrl+Shift+Delete -> Cached images and files).');
  bullet(ctx, 'If consistently slow on one workstation but fine on others, file an IT ticket — that machine may need maintenance.');

  h3(ctx, 'Browser shows "memory low" warning');
  paragraph(ctx,
    'Long shifts accumulate DOM nodes. Reload every 8-12 hours proactively — start-of-shift is a good time.',
  );

  h3(ctx, 'Page renders blank / white after reload');
  bullet(ctx, 'Force cache-bust: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac).');
  bullet(ctx, 'If still blank, check DevTools Console (F12 -> Console) for red errors and screenshot them for IT.');
  bullet(ctx, 'Try a different browser. Chrome is primary-supported; Edge and Firefox are secondary.');
  bullet(ctx, 'If blank on every workstation in the room, the server may have crashed. Check https://rmpgutah.us/api/health — if that is also down, page the on-call admin immediately.');

  h2(ctx, 'Printing & PDFs');

  h3(ctx, 'Downloaded PDF is blank or corrupted');
  bullet(ctx, 'Retry the download — generation is fast but can race conditions on slow machines.');
  bullet(ctx, 'Disable any browser extensions (ad blockers especially) that might interfere with blob URLs.');
  bullet(ctx, 'Try from a different browser.');

  h3(ctx, 'Cannot print from the browser');
  paragraph(ctx,
    'Open the downloaded PDF in your OS PDF viewer (Preview on Mac, Adobe Reader on Windows) and print from there. Browser-based printing sometimes mangles complex layouts.',
  );

  calloutBox(ctx, 'Emergency Contact',
    'Production issues during a shift that block dispatch: page the on-call admin immediately. System lockups: Ctrl+Shift+R to hard reload. If the app is unreachable on multiple workstations, fall back to radio + paper logs and resync from dispatch recordings when service returns. Never delay a response waiting for the console to come back.',
    'warn',
  );
}

function section10(ctx: GuideContext): void {
  title(ctx, '10. Radio Etiquette & Voice Protocols');

  paragraph(ctx,
    'The console is only half the job. Radio discipline — how you talk on the air — shapes how officers perceive dispatch and directly affects officer safety. A dispatcher who is calm, clear, and brief on the radio is worth more to the officers than any feature in this system.',
  );

  h2(ctx, 'Core Radio Principles');
  bullet(ctx, 'Calm first. Your voice sets the emotional tone for the entire shift. If you sound panicked, officers hear danger even when the facts do not warrant it.');
  bullet(ctx, 'Clear second. Pronounce every word fully. Avoid regional or personal slang.');
  bullet(ctx, 'Brief third. Every second of your airtime is a second that officers cannot use. Plan what you are going to say BEFORE you press the push-to-talk.');
  bullet(ctx, 'Acknowledge everything. Silence from dispatch feels like abandonment. A simple "10-4" confirms you received.');

  h2(ctx, 'Call Formats');
  paragraph(ctx,
    'Structure your transmissions so officers can predict what is coming. The agency-standard format for dispatching a call:',
  );
  paragraph(ctx,
    '"[Unit call sign], [dispatch]. [Priority], [nature of call] at [address or cross streets]. [Caller info or notable flags]."',
  );
  paragraph(ctx,
    'Example: "3-Adam, dispatch. P1, domestic in progress, 123 Main Street, apartment 4B. Caller states weapons involved, male subject in the garage."',
  );
  paragraph(ctx,
    'For status acknowledgments:',
  );
  bullet(ctx, 'Enroute acknowledgement: "3-Adam, enroute, 10-4."');
  bullet(ctx, 'On-scene acknowledgement: "3-Adam, 10-97."');
  bullet(ctx, 'Clear with disposition: "3-Adam, clear, report taken, 10-4."');

  h2(ctx, 'Phonetic Alphabet');
  paragraph(ctx,
    'Use the NATO phonetic alphabet for any letter that could be confused (most of them). Utah law enforcement standard phonetic set:',
  );
  table(ctx,
    ['Letter', 'Word', 'Letter', 'Word', 'Letter', 'Word'],
    [
      ['A', 'Adam',    'J', 'John',    'S', 'Sam'],
      ['B', 'Boy',     'K', 'King',    'T', 'Tom'],
      ['C', 'Charles', 'L', 'Lincoln', 'U', 'Union'],
      ['D', 'David',   'M', 'Mary',    'V', 'Victor'],
      ['E', 'Edward',  'N', 'Nora',    'W', 'William'],
      ['F', 'Frank',   'O', 'Ocean',   'X', 'X-ray'],
      ['G', 'George',  'P', 'Paul',    'Y', 'Young'],
      ['H', 'Henry',   'Q', 'Queen',   'Z', 'Zebra'],
      ['I', 'Ida',     'R', 'Robert',  '',  ''],
    ],
    [1, 3, 1, 3, 1, 3],
  );

  paragraph(ctx,
    'Example: plate 8-IDA-745 is spoken "eight, ida, seven four five" or "eight, india, seven four five" if your agency uses NATO instead of the law-enforcement variant. The RMPG standard is the law-enforcement set shown above.',
  );

  h2(ctx, 'Timing & Cadence');
  bullet(ctx, 'Pause one second after pressing the push-to-talk before you start speaking — otherwise the first syllable gets clipped.');
  bullet(ctx, 'Pause one second before releasing the push-to-talk, too — otherwise the last word gets clipped.');
  bullet(ctx, 'Speak slightly slower than conversational pace. Officers in moving vehicles with partial audio need every syllable.');
  bullet(ctx, 'Do not stack transmissions. If multiple units are calling, respond to one, then the next. "Stand by, 3-Bravo" tells a waiting unit they have been heard.');

  h2(ctx, 'Sensitive Transmissions');
  paragraph(ctx,
    'Anything that is audible on the main radio channel is heard by scanner listeners, bystanders, and media. Be mindful:',
  );
  bullet(ctx, 'Do not broadcast subject medical details over open radio. "Subject is in distress" is fine; "Subject has HIV, mental illness, and heart condition" is not.');
  bullet(ctx, 'Do not broadcast undercover or plainclothes officer names or locations. Use call signs only.');
  bullet(ctx, 'Do not broadcast surveillance target details. Move sensitive calls to a tactical channel (Tac 1 / Tac 2).');
  bullet(ctx, 'For juvenile-involved crimes, use "J/V" rather than "juvenile" when possible and never broadcast juvenile names.');

  h2(ctx, 'Voice Commands (Using the Brain)');
  paragraph(ctx,
    'With the Dispatcher Brain enabled (Section 7), you can speak commands to the console itself — not over the radio, but into the voice channel (V key or auto-listen). The system treats your voice as CAD command input.',
  );
  bullet(ctx, 'Speak naturally: "put 3-Adam on scene" works, "three adam ten ninety-seven" works, "ST 3A 10-97" works.');
  bullet(ctx, 'Confirmation: if the command mutates anything (status change, dispatch, clear), the system speaks confirmation back.');
  bullet(ctx, 'Low-confidence recognition: if the brain is uncertain, it asks "did you say X? please confirm" and waits for yes/no.');
  bullet(ctx, 'Mistakes: speak "cancel" or "nevermind" to void a pending command before it executes.');

  calloutBox(ctx, 'Voice + Radio',
    'Never mix the two channels. Voice commands to the brain are INPUT to the console. Radio transmissions are conversations with officers. If you press push-to-talk while the brain is listening, the brain will hear your radio-talk and try to parse it as a command. Toggle the voice channel off during radio traffic.',
  );
}

function section11(ctx: GuideContext): void {
  title(ctx, '11. Documentation Standards');

  paragraph(ctx,
    'Every keystroke in the dispatch console is potentially discoverable in legal proceedings. This section covers what to document, how to phrase it, and what belongs on which channel — dispatch notes vs. radio vs. email vs. supervisor memo.',
  );

  h2(ctx, 'The Dispatcher Notes Standard');
  paragraph(ctx,
    'Every call should have enough notes that a supervisor reading six months later can reconstruct what happened without talking to anyone. Good notes answer the journalistic five Ws plus one: who, what, when, where, why, how.',
  );

  h3(ctx, 'A good note example');
  paragraph(ctx,
    '"Caller (Sarah Miller, 801-555-0100) reports ex-boyfriend (John Doe, 34, last seen black hoodie black pants) banging on front door, threatening, possibly armed with bat. Subject left SB on State Street in blue Honda Civic, UT 8IDA745, approximately 5 minutes prior. Caller inside with two children, doors locked, staying on line."',
  );

  h3(ctx, 'A poor note example');
  paragraph(ctx,
    '"DV call. Guy left before we got there. Car was Honda."',
  );

  paragraph(ctx,
    'The poor example omits the caller identity, the subject\'s description, the direction of travel, the license plate, the timeline, the weapon, and the location of the caller inside the residence. A responding officer does not know whether to approach the address or try to intercept the vehicle.',
  );

  h2(ctx, 'Objective vs. Subjective');
  paragraph(ctx,
    'Objective notes record observations. Subjective notes record interpretations. Both have a place, but they must be clearly separated.',
  );
  bullet(ctx, 'Objective: "Caller is speaking in a low voice and asking dispatcher to stay on the line."');
  bullet(ctx, 'Subjective: "Caller sounds scared."');
  bullet(ctx, 'Both acceptable if framed: "Caller volume is low and breathing is rapid; audible fear in voice."');
  bullet(ctx, 'Unacceptable: "Caller is panicking and probably exaggerating."');

  h2(ctx, 'What Goes Where');
  table(ctx,
    ['Content', 'Channel'],
    [
      ['Factual call details, suspect description, timeline', 'Call notes (visible to all dispatchers + officers)'],
      ['Radio acknowledgements, unit status confirmations',   'Automatic audit log; no dispatcher action needed'],
      ['Operational coordination with another agency',        'Call notes (so your colleague can take over if needed)'],
      ['Personal observations about an officer or colleague', 'Supervisor email — NOT call notes'],
      ['Medical details of a subject',                        'Call notes only if operationally necessary; no diagnoses'],
      ['Juvenile personal information',                       'Redacted in call notes; full details only in secure incident report'],
      ['Your theories about guilt or motive',                 'Nowhere in the dispatch record'],
    ],
    [4, 6],
  );

  h2(ctx, 'Attribution & Timestamps');
  paragraph(ctx,
    'You do not need to write your name or the time in a note — the system stamps both automatically. Every note shows who wrote it and when. This means you can write shorter notes (just the content) and the reader can trace who did what.',
  );

  h2(ctx, 'Corrections');
  paragraph(ctx,
    'Once a note is committed it cannot be edited or deleted — the audit trail must be intact. To correct a note, add a new note that references the earlier entry: "Correction to note at 14:23: subject\'s last name is Doe, not Dow."',
  );
  paragraph(ctx,
    'This rule is important: the audit log is a legal record. Changing past notes after the fact destroys that legal weight. Your agency\'s policy (and Utah public-records law) require append-only notes.',
  );

  calloutBox(ctx, 'Policy',
    'Any attempt to edit or remove a committed note requires supervisor override and generates a mandatory review. "I fat-fingered the address" is corrected by a follow-up note, not by editing.',
    'warn',
  );
}

function section12(ctx: GuideContext): void {
  title(ctx, '12. Using the Map');

  paragraph(ctx,
    'The map is the spatial complement to the call list and unit roster. During a pursuit, tactical operation, or area search, the map becomes your primary situational-awareness surface.',
  );

  h2(ctx, 'Map Layers');
  bullet(ctx, 'Base map — dark CartoDB (Spillman-style) by default. Switch to Google Satellite for aerial imagery when searching outdoors.');
  bullet(ctx, 'Beat polygons — semi-transparent colored overlays showing sector and beat boundaries. Toggle visibility with the layer selector.');
  bullet(ctx, 'Unit GPS pins — live positions of all units with fresh GPS. Pin color matches unit status (green available, amber busy, red dispatched, etc.).');
  bullet(ctx, 'Active call markers — call icons at call locations. Priority-tinted same as the call list.');
  bullet(ctx, 'Breadcrumb trail — optional historical position trail for a selected unit; shows last 30 minutes.');
  bullet(ctx, 'Speed zones — admin-defined overlays for school zones, highways, etc.');
  bullet(ctx, 'Geofences — beat boundaries used by the Dispatcher Brain\'s geofence-breach rule.');

  h2(ctx, 'Common Map Actions');
  bullet(ctx, 'Click a unit pin — detail pane jumps to that unit. Shows live GPS, last update, current call.');
  bullet(ctx, 'Click a call marker — detail pane jumps to that call.');
  bullet(ctx, 'Right-click anywhere on the map — context menu with options including "New call at this location", "Run PR on this address", "Measure distance".');
  bullet(ctx, 'Drag and zoom as normal. Map state (center + zoom + active layers) persists per-workstation.');

  h2(ctx, 'Finding the Nearest Unit');
  paragraph(ctx,
    'When a call comes in at a known address, the map automatically lights up the three nearest available units. Their distance from the call is shown in the roster. Assign based on distance unless specialty is required.',
  );

  h2(ctx, 'Pursuit Tracking');
  paragraph(ctx,
    'During an active pursuit, pin the pursued unit and watch their GPS trail. The map auto-pans to keep them centered if you enable "Follow selected unit". Trail length increases to 60 minutes during pursuits for post-incident review.',
  );

  h2(ctx, 'Area Searches');
  bullet(ctx, 'Draw a search grid with the rectangle tool in the map toolbar.');
  bullet(ctx, 'Assign units to sectors of the grid verbally; track each unit\'s sector assignment in call notes.');
  bullet(ctx, 'Watch coverage by observing the breadcrumb trails.');

  h2(ctx, 'Map Troubleshooting');
  paragraph(ctx,
    'Map blank: tile cache may be empty. Admin -> Tiles -> Reseed. Unit pins missing: see "GPS not updating" in Section 9. Lag on pan/zoom: close other browser tabs and reload.',
  );
}

function section13(ctx: GuideContext): void {
  title(ctx, '13. Shift Change Procedure');

  paragraph(ctx,
    'Shift change is the riskiest 15-minute window of any dispatch day. Calls get dropped, units get double-counted, context disappears. A disciplined shift-change procedure prevents all of that.',
  );

  h2(ctx, 'Ten Minutes Before End of Shift');
  bullet(ctx, 'Stop taking new routine calls if possible — let the incoming dispatcher take them so they start fresh on their own work.');
  bullet(ctx, 'Exception: you still take P1/P2 calls; those cannot wait.');
  bullet(ctx, 'Begin the walkthrough with the incoming dispatcher if they are logged in early.');
  bullet(ctx, 'Open the Shift Handoff Notes (F8 -> HANDOFF) and jot anything that is not on a specific call: weather, road closures, BOLOs still active, supervisor reminders.');

  h2(ctx, 'Five Minutes Before');
  bullet(ctx, 'Walk through each active call in the detail pane. Summarize verbally: caller, location, nature, current status, what the officer is doing.');
  bullet(ctx, 'Walk through the unit roster. Which units are where, what each is doing, any units overdue for a status check.');
  bullet(ctx, 'Verify every on-scene unit has a recent status update — flag anything older than 6 minutes for the incoming dispatcher to watch.');

  h2(ctx, 'At End of Shift');
  bullet(ctx, 'Incoming dispatcher logs into their workstation.');
  bullet(ctx, 'Say out loud: "I am handing off [N] active calls and [M] units. You have command." Incoming dispatcher confirms "I have command." Both of you log the handoff verbally.');
  bullet(ctx, 'Incoming dispatcher takes over the call list; outgoing logs off and leaves the workstation clear.');
  bullet(ctx, 'Do NOT log off until the incoming dispatcher has explicitly taken command.');

  h2(ctx, 'Incoming Dispatcher Responsibilities');
  bullet(ctx, 'Arrive 10 minutes early. Log in, set up headset, read shift handoff notes.');
  bullet(ctx, 'Do the walkthrough actively — ask questions, repeat back key facts, verify you understand.');
  bullet(ctx, 'Note your start time in the dispatch log.');
  bullet(ctx, 'Ask about any ongoing investigations, BOLOs, or tactical operations that span shifts.');

  h2(ctx, 'Cross-Shift Calls');
  paragraph(ctx,
    'Some calls span shifts — long welfare investigations, continuing pursuits, DV investigations that take hours. These are the highest-risk handoffs because the incoming dispatcher has no context. For any call that has been active more than 30 minutes, treat the handoff as a formal briefing: what happened, what is happening now, what the next expected event is.',
  );

  calloutBox(ctx, 'Worst Case',
    'If a shift change happens during an active P1 pursuit or tactical operation, the outgoing dispatcher stays on until the incident is resolved. Do not hand off mid-pursuit. Continuity outweighs scheduled shift ends.',
    'warn',
  );
}

// ═══════════════════════════════════════════════════════════
// Sections 14-19 — coverage for subsystems that shipped after
// the original guide was authored. These stay fairly short on
// purpose; the guide is a quickref, not a manual. Deep content
// belongs in the in-app Help pages.
// ═══════════════════════════════════════════════════════════

function section14(ctx: GuideContext): void {
  title(ctx, '14. Real-Time Sync & Offline Behavior');

  paragraph(ctx,
    'Every workstation holds a WebSocket to the server. When a dispatcher changes a call, unit status, or premise alert, the server broadcasts the change to every other workstation within roughly one second. There is no manual refresh and no polling; if your screen does not show a recent change, the socket dropped — see below.',
  );

  drawWebSocketArchDiagram(ctx);

  h2(ctx, 'Connection Indicator');
  bullet(ctx, 'Status bar (bottom right): LIVE (green LED) means socket is connected and receiving events.');
  bullet(ctx, 'OFFLINE (red LED) means the socket has been closed for more than 3 seconds. Writes still work but updates from other workstations will not appear.');
  bullet(ctx, 'The console auto-reconnects with exponential backoff (1s, 2s, 4s, 8s, capped at 30s). You do not need to refresh.');
  bullet(ctx, 'After reconnect, the client re-fetches the active call list and unit roster so you catch up to any events missed while offline.');

  h2(ctx, 'Offline Survival');
  paragraph(ctx,
    'The service worker caches the full app shell, Google Maps tiles for Utah, and your most recent call/unit snapshot. If the server is unreachable, you can still:',
  );
  bullet(ctx, 'View the last known call stack and unit roster (read-only, marked STALE).');
  bullet(ctx, 'Pan and zoom the map — CartoDB dark_matter fallback tiles are pre-cached Z7-Z15 for the operational area.');
  bullet(ctx, 'Read already-opened incident and citation records from the local cache.');

  paragraph(ctx,
    'You CANNOT create or update anything while offline. Radio still works — use the backup paper log (pre-printed stack in the console drawer) and key the events into the system once connectivity returns.',
  );

  calloutBox(ctx, 'Important',
    'If you are unsure whether a dispatch went through, say so on the radio rather than silently retrying. Double-dispatches are far more dangerous than an extra transmission asking "10-9 on that last dispatch?"',
    'warn',
  );
}

function section15(ctx: GuideContext): void {
  title(ctx, '15. Map V2 (OpenLayers, Beta)');

  paragraph(ctx,
    'Map V2 is a parallel map surface at /map-v2 built on OpenLayers and the offline CartoDB raster tile cache. It runs read-only alongside the production Google Maps page at /map and exists so the team can iterate on a non-Google tile stack without risking the live dispatch map. Production dispatch continues to use /map — do NOT direct officers to V2 for live operations yet.',
  );

  h2(ctx, 'What V2 Shows Today');
  bullet(ctx, 'Base map: CartoDB dark_matter raster tiles (same ones the offline cache already holds).');
  bullet(ctx, 'Beat polygons: all 719 features from beat.geojson, colored by parent sector.');
  bullet(ctx, 'Live units and calls: pulled from /dispatch/units and /dispatch/calls?limit=200, refreshed on WebSocket unit_update and dispatch_update events (debounced).');
  bullet(ctx, 'Click a unit or call marker for a popup with ID, status, and location — same data as the /map hover cards.');

  h2(ctx, 'What V2 Cannot Do Yet');
  bullet(ctx, 'No drag-to-dispatch. Clicking a unit onto a call has no effect.');
  bullet(ctx, 'No drawing tools (route planning, perimeter, search grid).');
  bullet(ctx, 'No status changes from the map — use the roster.');
  bullet(ctx, 'No GPS breadcrumb playback.');

  paragraph(ctx,
    'Feature parity is tracked in the OpenLayers migration plan (docs/plans/2026-04-19-openlayers-migration-phase1.md). Until Phase 4 lands, all write paths stay on /map.',
  );

  calloutBox(ctx, 'Coordinate Gotcha',
    'Google Maps accepts {lat, lng} objects. OpenLayers wants [lng, lat] arrays in EPSG:3857. If you are debugging V2 and coordinates are in the wrong hemisphere, check that you are calling fromLonLat([lng, lat]) with LNG FIRST.',
    'info',
  );
}

function section16(ctx: GuideContext): void {
  title(ctx, '16. Field Interviews');

  paragraph(ctx,
    'A Field Interview (FI) is a documented contact with a person who is not being arrested, cited, or detained in an ongoing call. FI cards build the intelligence baseline — associates, known addresses, vehicles, tattoos — that drives the MNI dossier and compound search. Every FI auto-generates an FI-YY-NNNNN number and pins to a GPS point.',
  );

  h2(ctx, 'When to File an FI');
  bullet(ctx, 'Suspicious subject interviewed during a premise check or patrol.');
  bullet(ctx, 'Voluntary contact that produced useful intelligence (associates, vehicle, admission of parole status).');
  bullet(ctx, 'Passenger on a traffic stop who was not cited but is worth documenting.');
  bullet(ctx, 'Person at the scene of a call who was not a party to it but is worth remembering.');

  paragraph(ctx,
    'Do NOT file an FI for a subject who was arrested or cited — that information belongs on the arrest report or citation. FIs are for encounters that would otherwise leave no trail.',
  );

  h2(ctx, 'Dispatcher Role');
  bullet(ctx, 'Officer radios "show me out with one, need an FI" — dispatcher creates or locates the call (type PSO-CONTACT) and notes "FI pending".');
  bullet(ctx, 'Officer files the FI on their MDT. Dispatcher does not need to do anything in the FI form itself.');
  bullet(ctx, 'On clear, officer provides the FI number for the log. Confirm by repeating back before clearing.');

  h2(ctx, 'Finding FIs on a Person');
  paragraph(ctx,
    'From any person record, Intelligence -> Field Interviews lists every FI that person appears on. The map view (/field-interviews) supports radius search — useful for "show me every FI within 500 feet of this address in the last 90 days" when a dispatcher is building context for a responding officer.',
  );
}

function section17(ctx: GuideContext): void {
  title(ctx, '17. Process Service / Serve Queue');

  paragraph(ctx,
    'RMPG holds a process-service contract alongside patrol. The Serve Queue is the list of legal documents (subpoenas, summons, eviction notices, restraining orders, small-claims papers) that have been accepted for service and are awaiting officer assignment and attempt.',
  );

  h2(ctx, 'Lifecycle');
  bullet(ctx, 'Intake: document scanned, recipient and deadline entered, job created. Auto-geocoded to the service address.');
  bullet(ctx, 'Assignment: dispatcher or supervisor assigns the job to a specific officer (or to a zone pool).');
  bullet(ctx, 'Attempt: officer marks attempted — photo, signature, GPS, attempt outcome (served / no contact / refused / bad address).');
  bullet(ctx, 'Close: after successful service OR after the contractual attempt limit, the job closes with a final disposition.');

  h2(ctx, 'PSO Calls That Auto-Create Serve Jobs');
  paragraph(ctx,
    'When a PSO-type call is dispatched with a document-service intent, the serveQueueLinker utility on the server side auto-creates the serve job from the call fields. The call and the serve job stay linked — clearing the call does NOT close the serve job; that has to happen on the serve side.',
  );

  h2(ctx, 'Route Planning');
  paragraph(ctx,
    'The Serve Routes feature clusters pending jobs by geography into an optimized day-route with waypoints. This is most useful for contract managers and process servers planning a shift, not for live dispatch.',
  );

  calloutBox(ctx, 'Privacy',
    'Serve records contain sensitive information — restraining-order addresses, family names in eviction notices. Serve job details are visible only to roles with process_server, contract_manager, supervisor, or admin. Do NOT read serve contents over an open radio channel.',
    'warn',
  );
}

function section18(ctx: GuideContext): void {
  title(ctx, '18. Skip Tracer V2');

  paragraph(ctx,
    'Skip Tracer V2 is the consolidated person-search tool under Intelligence -> Skip Tracer. It queries 22 public and agency data sources in parallel and returns a deduplicated result set. Adapters handle rate limiting, response caching, and per-source retry so you do not burn a lookup quota on a flaky source.',
  );

  drawSkipTracerFanoutDiagram(ctx);

  h2(ctx, 'Covered Sources (Partial)');
  bullet(ctx, 'FBI Wanted and OFAC sanctions lists (federal flags, highest-priority hit).');
  bullet(ctx, 'National Sex Offender Public Registry (NSOPW).');
  bullet(ctx, 'Utah State Court docket search.');
  bullet(ctx, 'SLC Assessor property records (address history and ownership).');
  bullet(ctx, 'Salt Lake County jail roster (current and recent bookings).');
  bullet(ctx, 'Social and professional directory adapters.');

  h2(ctx, 'Dispatcher Use Cases');
  bullet(ctx, 'A 10-29 (wants/warrant check) that needs more than NCIC — skip tracer adds civil, sex offender, and federal context.');
  bullet(ctx, 'Welfare check on a subject whose last known address is stale. Skip tracer may surface recent property or arrest activity pointing at a newer address.');
  bullet(ctx, 'Pre-dispatch context for a PSO serve job where the recipient "should be" at the service address but has not been seen there.');

  calloutBox(ctx, 'Legal',
    'Skip Tracer V2 searches are audited. Each lookup requires a case number or an incident number as justification. Running a skip trace without a legitimate law-enforcement purpose is a policy violation and potentially a criminal one.',
    'warn',
  );
}

function section19(ctx: GuideContext): void {
  title(ctx, '19. Compound & Universal Search');

  paragraph(ctx,
    'Two complementary search tools live under Records -> Search. Compound Search is a structured NCIC-style query form; Universal Search is a single box that fans out across nine record types.',
  );

  h2(ctx, 'Compound Search');
  paragraph(ctx,
    'The compound form accepts multiple simultaneous criteria and returns records that match ALL of them. Most-used fields:',
  );
  bullet(ctx, 'Name: supports wildcards (SMITH*, *JOHN*, ?ARKUS). Partial-match is default.');
  bullet(ctx, 'DOB: accepts a single date or a date range (useful when DOB is approximate).');
  bullet(ctx, 'Physical description: height / weight ranges, hair, eyes, build, distinguishing marks.');
  bullet(ctx, 'Address: radius search — "everyone in our records within 500 feet of this point."');
  bullet(ctx, 'Vehicle plate: partial or full, plus state and year range.');
  bullet(ctx, 'Flags: officer safety, mental health, gang affiliate, known associate — boolean filter.');

  h2(ctx, 'Universal Search');
  paragraph(ctx,
    'Universal Search takes one query string and returns grouped hits across persons, vehicles, calls, incidents, citations, arrests, warrants, field interviews, and properties. Use it when you do not yet know what kind of record you are looking for — a name that might be a person or might be a business, a number that might be a plate or might be a case number.',
  );

  h2(ctx, 'MNI Dossier');
  paragraph(ctx,
    'From any person hit, the Dossier button (or /api/records/persons/:id/dossier) compiles the full intelligence package — every call, incident, citation, arrest, warrant, FI, associate, and vehicle linkage for that person, in one scrollable document. This is the right artifact to hand to a responding officer before they get on scene with a high-risk subject.',
  );

  calloutBox(ctx, 'Tip',
    'Save frequent compound-search configurations as Saved Searches. Common examples: "All active P1 callers in Beat 14 this shift", "All field interviews of a specific gang affiliation in the last 30 days". Saved searches are per-user and do not leak across accounts.',
    'info',
  );
}

// ═══════════════════════════════════════════════════════════
// Sections 20-22 — deep educational content. These sections
// are intentionally longer than 1-19 because they are the
// "learning" material a new dispatcher reads once cover-to-
// cover, whereas 1-19 are reference content a working
// dispatcher flips to as needed.
// ═══════════════════════════════════════════════════════════

/**
// ═══════════════════════════════════════════════════════════
// Section diagrams. Each drawXxxDiagram() is a self-contained
// vector rendering that advances ctx.y past its own height.
// Call these from within the relevant section function, after
// the opening paragraph and before the prose that references
// the figure number.
// ═══════════════════════════════════════════════════════════

/**
 * Fig. 2-1 — Call state lifecycle. Five state boxes left-to-right
 * with transition arrows and typical timings. Dispatched-unstuck
 * and on-scene-stuck thresholds annotated below the states they
 * apply to.
 */
function drawCallLifecycleDiagram(ctx: GuideContext): void {
  ensureSpace(ctx, 170);
  const d = ctx.doc;
  const x = PAGE.MARGIN;
  const y = ctx.y;
  const w = PAGE.W - PAGE.MARGIN * 2;
  const h = 150;

  dFrame(d, x, y, w, h);

  const states: Array<[string, string]> = [
    ['PENDING',     'F2 opens intake\nunassigned'],
    ['DISPATCHED',  'Unit(s) assigned\nnot moving'],
    ['ENROUTE',     'F5 set\nunit moving'],
    ['ON SCENE',    'F6 set\nunit at location'],
    ['CLEARED',     'F7 + disposition\nauditable close'],
  ];
  const boxW = 76;
  const boxH = 44;
  const gap = (w - boxW * states.length - 24) / (states.length - 1);
  const cy = y + 40;

  const boxes: ReturnType<typeof dBox>[] = [];
  for (let i = 0; i < states.length; i++) {
    const bx = x + 12 + i * (boxW + gap);
    const [title, sub] = states[i];
    const box = dBox(d, bx, cy, boxW, boxH, `${title}\n${sub}`, {
      fill: i === 0 ? '#141414' : (i === states.length - 1 ? '#0d2818' : '#1a1a1a'),
      stroke: COLOR.ACCENT,
      textColor: '#e5e5e5',
      fontSize: 7,
      bold: true,
    });
    boxes.push(box);
  }
  for (let i = 0; i < boxes.length - 1; i++) {
    const from = boxes[i];
    const to = boxes[i + 1];
    dArrow(d, from.x + from.w, from.y + boxH / 2, to.x, to.y + boxH / 2);
  }

  // Timing callouts under the relevant transition
  d.setFont('helvetica', 'italic');
  d.setFontSize(7);
  d.setTextColor('#888888');
  d.text('P1: dispatch <45s', boxes[0].x + boxW + gap / 2, cy + boxH + 12, { align: 'center' });
  d.text('brain alerts >90s', boxes[1].x + boxW + gap / 2, cy + boxH + 12, { align: 'center' });
  d.text('P1: 3-5 min', boxes[2].x + boxW + gap / 2, cy + boxH + 12, { align: 'center' });
  d.text('brain alerts >8 min', boxes[3].x + boxW + gap / 2, cy + boxH + 12, { align: 'center' });

  // Rewind arrow: CLEARED -> (archive); PENDING <- (new call)
  d.setDrawColor('#888888');
  d.setLineWidth(0.5);
  d.text('Every transition is audited (who, when, from -> to, unit)', x + w / 2, y + h - 8, { align: 'center' });

  ctx.y = y + h + 8;
  dCaption(ctx, 'Fig. 2-1 — Call state lifecycle with typical transition timings.');
}

/**
 * Fig. 3-1 — Unit status state machine. Nodes for each status with
 * directional edges showing legal transitions. Uses a hub-and-spoke
 * layout because AVAILABLE is the central hub most transitions pass
 * through.
 */
function drawUnitStatusDiagram(ctx: GuideContext): void {
  ensureSpace(ctx, 280);
  const d = ctx.doc;
  const x = PAGE.MARGIN;
  const y = ctx.y;
  const w = PAGE.W - PAGE.MARGIN * 2;
  const h = 260;

  dFrame(d, x, y, w, h);

  const cx = x + w / 2;
  const cy = y + h / 2;

  // Central hub: AVAILABLE
  const hub = dBox(d, cx - 50, cy - 18, 100, 36, 'AVAILABLE', {
    fill: '#0d2818', stroke: '#166534', textColor: '#22c55e', fontSize: 10, bold: true,
  });

  // Satellite nodes: DISPATCHED, ENROUTE, ON SCENE, BUSY, OUT OF SERVICE, OFF DUTY
  const satellites: Array<{ label: string; dx: number; dy: number; color: string }> = [
    { label: 'OFF DUTY',     dx:    0, dy: -100, color: '#666666' },
    { label: 'DISPATCHED',   dx:  170, dy:  -70, color: '#d4a017' },
    { label: 'ENROUTE',      dx:  170, dy:    0, color: '#d4a017' },
    { label: 'ON SCENE',     dx:  170, dy:   70, color: '#b91c1c' },
    { label: 'BUSY',         dx: -170, dy:  -70, color: '#d97706' },
    { label: 'OUT OF SVC',   dx: -170, dy:   70, color: '#888888' },
  ];
  const nodes: Record<string, ReturnType<typeof dBox>> = { AVAILABLE: hub };
  for (const s of satellites) {
    const nx = cx + s.dx - 42;
    const ny = cy + s.dy - 14;
    nodes[s.label] = dBox(d, nx, ny, 84, 28, s.label, {
      fill: '#141414', stroke: s.color, textColor: s.color, fontSize: 8, bold: true,
    });
  }

  // Transitions (edges). Each edge is rendered with dArrow.
  const edge = (fromLabel: string, toLabel: string, label?: string) => {
    const f = nodes[fromLabel];
    const t = nodes[toLabel];
    if (!f || !t) return;
    // Attach at nearest edge midpoints
    const fxCenter = f.x + f.w / 2;
    const fyCenter = f.y + f.h / 2;
    const txCenter = t.x + t.w / 2;
    const tyCenter = t.y + t.h / 2;
    const dx = txCenter - fxCenter;
    const dy = tyCenter - fyCenter;
    const angle = Math.atan2(dy, dx);
    const fRx = (Math.abs(Math.cos(angle)) > 0.5) ? f.w / 2 : Math.abs(dx / dy) * (f.h / 2);
    const fRy = (Math.abs(Math.sin(angle)) > 0.5) ? f.h / 2 : Math.abs(dy / dx) * (f.w / 2);
    const tRx = (Math.abs(Math.cos(angle)) > 0.5) ? t.w / 2 : Math.abs(dx / dy) * (t.h / 2);
    const tRy = (Math.abs(Math.sin(angle)) > 0.5) ? t.h / 2 : Math.abs(dy / dx) * (t.w / 2);
    const startX = fxCenter + Math.cos(angle) * Math.min(fRx, f.w / 2);
    const startY = fyCenter + Math.sin(angle) * Math.min(fRy, f.h / 2);
    const endX = txCenter - Math.cos(angle) * Math.min(tRx, t.w / 2);
    const endY = tyCenter - Math.sin(angle) * Math.min(tRy, t.h / 2);
    dArrow(d, startX, startY, endX, endY, label);
  };

  edge('OFF DUTY', 'AVAILABLE', 'log on');
  edge('AVAILABLE', 'DISPATCHED', 'F3');
  edge('DISPATCHED', 'ENROUTE', 'F5');
  edge('ENROUTE', 'ON SCENE', 'F6');
  edge('ON SCENE', 'AVAILABLE', 'F7');
  edge('AVAILABLE', 'BUSY');
  edge('BUSY', 'AVAILABLE');
  edge('AVAILABLE', 'OUT OF SVC');
  edge('OUT OF SVC', 'AVAILABLE');
  edge('AVAILABLE', 'OFF DUTY', 'log off');

  ctx.y = y + h + 8;
  dCaption(ctx, 'Fig. 3-1 — Legal unit status transitions. AVAILABLE is the hub; illegal transitions are blocked by the server.');
}

/**
 * Fig. 4-1 — Priority triage pyramid. Four horizontal bars stacked
 * narrowest-at-top (P1) to widest-at-bottom (P4) to visually reinforce
 * that most calls are P3/P4 and only a small fraction are true P1s.
 */
function drawPriorityPyramidDiagram(ctx: GuideContext): void {
  ensureSpace(ctx, 200);
  const d = ctx.doc;
  const x = PAGE.MARGIN;
  const y = ctx.y;
  const w = PAGE.W - PAGE.MARGIN * 2;
  const h = 180;

  dFrame(d, x, y, w, h);

  const levels: Array<{ p: string; label: string; color: string; widthPct: number; freq: string }> = [
    { p: 'P1', label: 'Life / safety emergency',      color: '#b91c1c', widthPct: 0.20, freq: '~2% of calls'  },
    { p: 'P2', label: 'Crime in progress / urgent',   color: '#d97706', widthPct: 0.40, freq: '~15% of calls' },
    { p: 'P3', label: 'Routine',                      color: '#ca8a04', widthPct: 0.65, freq: '~55% of calls' },
    { p: 'P4', label: 'Cold / report only',           color: '#6b7280', widthPct: 0.85, freq: '~28% of calls' },
  ];

  const barH = 28;
  const gap = 6;
  const cx = x + w / 2;

  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const bw = (w - 40) * lvl.widthPct;
    const bx = cx - bw / 2;
    const by = y + 20 + i * (barH + gap);
    d.setFillColor(lvl.color);
    d.setDrawColor(lvl.color);
    d.roundedRect(bx, by, bw, barH, 2, 2, 'F');

    // Priority badge (left)
    d.setFont('helvetica', 'bold');
    d.setFontSize(14);
    d.setTextColor('#ffffff');
    d.text(lvl.p, bx + 10, by + barH / 2 + 5);

    // Label (center)
    d.setFontSize(9);
    d.text(lvl.label, bx + bw / 2, by + barH / 2 + 3, { align: 'center' });

    // Frequency (right, outside the bar)
    d.setFont('helvetica', 'italic');
    d.setFontSize(8);
    d.setTextColor('#888888');
    d.text(lvl.freq, x + w - 10, by + barH / 2 + 3, { align: 'right' });
  }

  // Response time column on left
  d.setFont('helvetica', 'normal');
  d.setFontSize(7);
  d.setTextColor('#888888');
  d.text('lights + siren',  x + 8, y + 20 + barH / 2 + 3);
  d.text('prompt, no L&S',  x + 8, y + 20 + (barH + gap) + barH / 2 + 3);
  d.text('closest unit',    x + 8, y + 20 + 2 * (barH + gap) + barH / 2 + 3);
  d.text('phone / deferred',x + 8, y + 20 + 3 * (barH + gap) + barH / 2 + 3);

  ctx.y = y + h + 8;
  dCaption(ctx, 'Fig. 4-1 — Priority pyramid. Bar width is proportional to typical call-volume share.');
}

/**
 * Fig. 5-1 — F-key keyboard layout. Renders a stylized keyboard row
 * with F1-F12 keys and their dispatch-console mapping printed
 * underneath each. Includes ESC + a "cmd" marker to orient readers.
 */
function drawFKeyboardDiagram(ctx: GuideContext): void {
  ensureSpace(ctx, 130);
  const d = ctx.doc;
  const x = PAGE.MARGIN;
  const y = ctx.y;
  const w = PAGE.W - PAGE.MARGIN * 2;
  const h = 110;

  dFrame(d, x, y, w, h);

  const keys: Array<[string, string]> = [
    ['F1', 'Help'],
    ['F2', 'New Call'],
    ['F3', 'Dispatch'],
    ['F4', 'Select Unit'],
    ['F5', 'Enroute'],
    ['F6', 'On Scene'],
    ['F7', 'Clear'],
    ['F8', 'CMD Line'],
    ['F9', 'Voice Toggle'],
    ['F10', 'Mic Arm'],
    ['F11', 'BOLO Panel'],
    ['F12', 'NCIC / Panic'],
  ];
  const keyW = (w - 24) / 12;
  const keyH = 44;
  const keyY = y + 28;

  d.setFont('helvetica', 'bold');
  d.setFontSize(7);
  d.setTextColor('#888888');
  d.text('KEYBOARD  F-ROW', x + 12, y + 18);

  for (let i = 0; i < keys.length; i++) {
    const [label, action] = keys[i];
    const kx = x + 12 + i * keyW;
    // Key cap
    d.setFillColor('#1a1a1a');
    d.setDrawColor('#444444');
    d.setLineWidth(0.75);
    d.roundedRect(kx, keyY, keyW - 4, keyH, 3, 3, 'FD');
    // Inner highlight
    d.setDrawColor('#2a2a2a');
    d.setLineWidth(0.3);
    d.roundedRect(kx + 2, keyY + 2, keyW - 8, keyH - 4, 2, 2, 'S');
    // Key label
    d.setFont('helvetica', 'bold');
    d.setFontSize(9);
    d.setTextColor(COLOR.ACCENT);
    d.text(label, kx + (keyW - 4) / 2, keyY + 16, { align: 'center' });
    // Action
    d.setFont('helvetica', 'normal');
    d.setFontSize(6.5);
    d.setTextColor('#e5e5e5');
    const actLines = d.splitTextToSize(action, keyW - 8) as string[];
    for (let li = 0; li < actLines.length; li++) {
      d.text(actLines[li], kx + (keyW - 4) / 2, keyY + 28 + li * 8, { align: 'center' });
    }
  }

  // Modifier strip
  d.setFont('helvetica', 'italic');
  d.setFontSize(7);
  d.setTextColor('#888888');
  d.text('Modifiers: Shift+F-key = reverse action  |  Ctrl+F-key = same action for previously selected unit/call', x + 12, y + h - 8);

  ctx.y = y + h + 8;
  dCaption(ctx, 'Fig. 5-1 — F-key mapping for the dispatch console. Hints echo in the bottom status bar.');
}

/**
 * Fig. 7-1 — Dispatcher Brain signal flow. Horizontal pipeline:
 * Mic -> STT -> NLU -> Rule Engine -> Event Bus -> TTS -> Speakers.
 * Rule Engine has a sideband input from the Call/Unit Event Stream
 * coming from WebSocket, since brain reacts to system events too.
 */
function drawBrainPipelineDiagram(ctx: GuideContext): void {
  ensureSpace(ctx, 180);
  const d = ctx.doc;
  const x = PAGE.MARGIN;
  const y = ctx.y;
  const w = PAGE.W - PAGE.MARGIN * 2;
  const h = 160;

  dFrame(d, x, y, w, h);

  const stages: string[] = ['Microphone', 'Web Speech\nRecognition', 'Intent\nParser', 'Rule Engine', 'Event Bus', 'Edge TTS\nSynthesis', 'Speakers'];
  const boxW = 62;
  const boxH = 38;
  const gap = (w - boxW * stages.length - 24) / (stages.length - 1);
  const cy = y + 40;

  const boxes: ReturnType<typeof dBox>[] = [];
  for (let i = 0; i < stages.length; i++) {
    const bx = x + 12 + i * (boxW + gap);
    const isRule = stages[i] === 'Rule Engine';
    boxes.push(dBox(d, bx, cy, boxW, boxH, stages[i], {
      fill: isRule ? '#1f1a00' : '#141414',
      stroke: isRule ? COLOR.ACCENT : '#2e2e2e',
      textColor: '#e5e5e5',
      fontSize: 7,
      bold: isRule,
    }));
  }
  for (let i = 0; i < boxes.length - 1; i++) {
    dArrow(d, boxes[i].x + boxW, boxes[i].y + boxH / 2, boxes[i + 1].x, boxes[i + 1].y + boxH / 2);
  }

  // Sideband: WebSocket event stream feeding Rule Engine
  const sideY = cy + 80;
  const sideBox = dBox(d, x + w / 2 - 90, sideY, 180, 28, 'WebSocket: call/unit/premise events', {
    fill: '#0d1a2b', stroke: '#2b4b6b', textColor: '#93c5fd', fontSize: 8, bold: true,
  });
  // Arrow from sideband up to Rule Engine
  const ruleBox = boxes[3];
  dArrow(d,
    sideBox.x + sideBox.w / 2, sideBox.y,
    ruleBox.x + ruleBox.w / 2, ruleBox.y + ruleBox.h,
    undefined, '#93c5fd',
  );

  // Labels
  d.setFont('helvetica', 'italic');
  d.setFontSize(6.5);
  d.setTextColor('#888888');
  d.text('YOUR VOICE  ->', x + 20, cy - 8);
  d.text('<- BRAIN SPEAKS', x + w - 20, cy - 8, { align: 'right' });

  ctx.y = y + h + 8;
  dCaption(ctx, 'Fig. 7-1 — Dispatcher Brain signal flow. Rule Engine fires on both your speech AND live system events.');
}

/**
 * Fig. 14-1 — WebSocket sync architecture. Central server with four
 * client workstations + one MDT connected via WS. Shows the
 * broadcast pattern ("any dispatcher's change propagates to all
 * peers within ~1s") and the offline queue.
 */
function drawWebSocketArchDiagram(ctx: GuideContext): void {
  ensureSpace(ctx, 240);
  const d = ctx.doc;
  const x = PAGE.MARGIN;
  const y = ctx.y;
  const w = PAGE.W - PAGE.MARGIN * 2;
  const h = 220;

  dFrame(d, x, y, w, h);

  // Central server node
  const cx = x + w / 2;
  const cy = y + h / 2 - 10;
  const server = dBox(d, cx - 70, cy - 22, 140, 44, 'RMPG FLEX SERVER\nws://rmpgutah.us', {
    fill: '#1f1a00', stroke: COLOR.ACCENT, textColor: COLOR.ACCENT, fontSize: 9, bold: true,
  });

  // Database below server
  const db = dBox(d, cx - 50, cy + 40, 100, 24, 'SQLite (audit log)', {
    fill: '#0a0a0a', stroke: '#2e2e2e', textColor: '#888888', fontSize: 8,
  });
  dArrow(d, server.x + server.w / 2, server.y + server.h, db.x + db.w / 2, db.y, undefined, '#888888');

  // Four client workstations in a semicircle above
  const clients = [
    { label: 'Dispatcher A\n(console)',  angle: -Math.PI * 0.85 },
    { label: 'Dispatcher B\n(console)',  angle: -Math.PI * 0.65 },
    { label: 'Supervisor\n(console)',    angle: -Math.PI * 0.35 },
    { label: 'Unit U07\n(MDT)',           angle: -Math.PI * 0.15 },
  ];
  const radius = 90;
  for (const c of clients) {
    const ncx = cx + Math.cos(c.angle) * radius;
    const ncy = cy + Math.sin(c.angle) * radius * 0.8;
    const nb = dBox(d, ncx - 48, ncy - 16, 96, 32, c.label, {
      fill: '#141414', stroke: '#166534', textColor: '#22c55e', fontSize: 7, bold: true,
    });
    // Bidirectional arrow indicator (two lines)
    const fx = nb.x + nb.w / 2;
    const fy = nb.y + nb.h;
    const tx = server.x + server.w / 2;
    const ty = server.y;
    dArrow(d, fx, fy, tx + 10, ty - 1, undefined, '#22c55e');
    dArrow(d, tx - 10, ty, fx, fy, undefined, '#22c55e');
  }

  // Offline queue indicator
  d.setFont('helvetica', 'italic');
  d.setFontSize(7);
  d.setTextColor('#888888');
  d.text('Every change -> server -> broadcast to every peer within ~1s.', x + w / 2, y + h - 22, { align: 'center' });
  d.text('Offline: writes queue in IndexedDB and replay on reconnect.', x + w / 2, y + h - 10, { align: 'center' });

  ctx.y = y + h + 8;
  dCaption(ctx, 'Fig. 14-1 — Real-time sync topology. Single server, N clients, WebSocket broadcast.');
}

/**
 * Fig. 18-1 — Skip Tracer V2 fan-out. Central query node with 22
 * source adapters fanning out in a radial pattern, grouped by
 * category (federal, state, local, open-source).
 */
function drawSkipTracerFanoutDiagram(ctx: GuideContext): void {
  ensureSpace(ctx, 260);
  const d = ctx.doc;
  const x = PAGE.MARGIN;
  const y = ctx.y;
  const w = PAGE.W - PAGE.MARGIN * 2;
  const h = 240;

  dFrame(d, x, y, w, h);

  // Central query node
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hub = dBox(d, cx - 50, cy - 16, 100, 32, 'SKIP TRACER', {
    fill: '#1f1a00', stroke: COLOR.ACCENT, textColor: COLOR.ACCENT, fontSize: 10, bold: true,
  });

  // 22 source adapters in a ring — grouped by color category
  const sources: Array<{ label: string; cat: 'fed' | 'state' | 'local' | 'oss' }> = [
    { label: 'FBI WANTED',     cat: 'fed'   },
    { label: 'OFAC',           cat: 'fed'   },
    { label: 'NSOPW',          cat: 'fed'   },
    { label: 'TSA No-Fly',     cat: 'fed'   },
    { label: 'DEA Diversion',  cat: 'fed'   },
    { label: 'UT Courts',      cat: 'state' },
    { label: 'UT DMV',         cat: 'state' },
    { label: 'UT DOC',         cat: 'state' },
    { label: 'UT MVR',         cat: 'state' },
    { label: 'UT BCI',         cat: 'state' },
    { label: 'SLC Assessor',   cat: 'local' },
    { label: 'SL Co Jail',     cat: 'local' },
    { label: 'SLCPD RMS',      cat: 'local' },
    { label: 'UPD RMS',        cat: 'local' },
    { label: 'SL Co Rec',      cat: 'local' },
    { label: 'Voter Reg',      cat: 'oss'   },
    { label: 'Social Dir',     cat: 'oss'   },
    { label: 'Prof Licenses',  cat: 'oss'   },
    { label: 'Business Reg',   cat: 'oss'   },
    { label: 'News Archive',   cat: 'oss'   },
    { label: 'Obituaries',     cat: 'oss'   },
    { label: 'Utility Lookup', cat: 'oss'   },
  ];
  const catColors: Record<string, { fill: string; stroke: string; text: string }> = {
    fed:   { fill: '#1a0505', stroke: '#b91c1c', text: '#fca5a5' },
    state: { fill: '#0a1a2b', stroke: '#2563eb', text: '#93c5fd' },
    local: { fill: '#0d2818', stroke: '#166534', text: '#86efac' },
    oss:   { fill: '#141414', stroke: '#666666', text: '#cccccc' },
  };

  const radius = 88;
  for (let i = 0; i < sources.length; i++) {
    const angle = (-Math.PI / 2) + (i / sources.length) * Math.PI * 2;
    const nx = cx + Math.cos(angle) * radius;
    const ny = cy + Math.sin(angle) * radius;
    const src = sources[i];
    const c = catColors[src.cat];
    const box = dBox(d, nx - 26, ny - 7, 52, 14, src.label, {
      fill: c.fill, stroke: c.stroke, textColor: c.text, fontSize: 6, bold: true,
    });
    // Thin line from hub to source
    d.setDrawColor(c.stroke);
    d.setLineWidth(0.3);
    d.line(cx, cy, box.x + box.w / 2, box.y + box.h / 2);
  }

  // Legend
  const legendY = y + h - 14;
  const legX = x + 12;
  let lx = legX;
  const legends: Array<[string, string]> = [
    ['fed', 'Federal'],
    ['state', 'State (UT)'],
    ['local', 'Local'],
    ['oss', 'Open-source'],
  ];
  d.setFont('helvetica', 'normal');
  d.setFontSize(7);
  for (const [cat, name] of legends) {
    const c = catColors[cat];
    d.setFillColor(c.stroke);
    d.rect(lx, legendY - 6, 6, 6, 'F');
    d.setTextColor('#888888');
    d.text(name, lx + 10, legendY - 1);
    lx += d.getTextWidth(name) + 26;
  }

  ctx.y = y + h + 8;
  dCaption(ctx, 'Fig. 18-1 — Skip Tracer V2 source fan-out. 22 parallel adapters grouped by jurisdiction.');
}

/**
 * Fig. 21-1 — Shots-fired call timeline. Horizontal timeline from
 * T+00:00 to T+20:30 with annotated event markers for every
 * critical moment in the worked example.
 */
function drawCallTimelineDiagram(ctx: GuideContext): void {
  ensureSpace(ctx, 220);
  const d = ctx.doc;
  const x = PAGE.MARGIN;
  const y = ctx.y;
  const w = PAGE.W - PAGE.MARGIN * 2;
  const h = 200;

  dFrame(d, x, y, w, h);

  // Horizontal axis: T+00:00 to T+21:00 (21 minutes)
  const axisY = y + 100;
  const axisX0 = x + 30;
  const axisX1 = x + w - 20;
  const axisW = axisX1 - axisX0;
  const durationMin = 21;

  d.setDrawColor(COLOR.ACCENT);
  d.setLineWidth(1);
  d.line(axisX0, axisY, axisX1, axisY);

  // Minute ticks (every 3 minutes)
  d.setFont('helvetica', 'normal');
  d.setFontSize(6.5);
  d.setTextColor('#888888');
  for (let m = 0; m <= durationMin; m += 3) {
    const tx = axisX0 + (m / durationMin) * axisW;
    d.setDrawColor('#666666');
    d.setLineWidth(0.5);
    d.line(tx, axisY - 2, tx, axisY + 2);
    d.text(`T+${String(m).padStart(2, '0')}:00`, tx, axisY + 12, { align: 'center' });
  }

  const events: Array<{ min: number; label: string; side: 'top' | 'bot'; color: string }> = [
    { min: 0,     label: 'Phone rings\nF2 pressed',   side: 'top', color: '#d4a017' },
    { min: 0.3,   label: 'Caller speaks\nlocation',   side: 'bot', color: '#888888' },
    { min: 0.4,   label: 'Incident type\nclassified', side: 'top', color: '#888888' },
    { min: 0.42,  label: 'Voice channel\nalert',       side: 'bot', color: '#d4a017' },
    { min: 0.47,  label: 'U07 enroute (F5)',          side: 'top', color: '#22c55e' },
    { min: 0.97,  label: 'Caller update:\nveh flees',  side: 'bot', color: '#b91c1c' },
    { min: 1.07,  label: 'U07 diverts\nto intercept',  side: 'top', color: '#888888' },
    { min: 1.8,   label: 'U12 on scene\n(F6)',         side: 'bot', color: '#b91c1c' },
    { min: 2.5,   label: 'BOLO broadcast\n(F8 + bolo)',side: 'top', color: '#d4a017' },
    { min: 4.7,   label: 'U07 posted\n(F6)',           side: 'bot', color: '#b91c1c' },
    { min: 12.5,  label: 'U12 clears\n(F7)',           side: 'top', color: '#22c55e' },
    { min: 20.25, label: 'U07 clears\n(F7)',           side: 'bot', color: '#22c55e' },
    { min: 20.5,  label: 'Close call\ndisp: GOA',      side: 'top', color: '#666666' },
  ];

  for (const ev of events) {
    const ex = axisX0 + (ev.min / durationMin) * axisW;
    d.setFillColor(ev.color);
    d.circle(ex, axisY, 2.5, 'F');
    const labelY = ev.side === 'top' ? axisY - 30 : axisY + 30;
    const anchorY = ev.side === 'top' ? axisY - 6 : axisY + 6;
    d.setDrawColor(ev.color);
    d.setLineWidth(0.4);
    d.line(ex, anchorY, ex, labelY + (ev.side === 'top' ? 14 : -4));
    d.setFont('helvetica', 'bold');
    d.setFontSize(6);
    d.setTextColor(ev.color);
    const lines = ev.label.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ly = ev.side === 'top' ? labelY + i * 7 : labelY + i * 7;
      d.text(lines[i], ex, ly, { align: 'center' });
    }
  }

  // Title strip
  d.setFont('helvetica', 'bold');
  d.setFontSize(9);
  d.setTextColor(COLOR.ACCENT);
  d.text('SHOTS FIRED — 2100 S STATE — P1 — DISP T+0 -> CLOSE T+20:30', x + w / 2, y + 16, { align: 'center' });

  ctx.y = y + h + 8;
  dCaption(ctx, 'Fig. 21-1 — Worked-example call timeline. Green = resolution events, red = on-scene, gold = dispatcher action.');
}

/**
 * Render a stylized, annotated anatomy diagram of the dispatch console.
 * Every labeled region corresponds to a bullet in the accompanying prose.
 * We draw it in vector primitives (no image payload) so it stays crisp on
 * a commander's 13" laptop and on a 32" console workstation alike.
 *
 * The diagram is roughly 500pt wide by 320pt tall and should be rendered
 * just after the section title so the prose can reference regions by
 * number.
 */
function drawConsoleAnatomyDiagram(ctx: GuideContext): void {
  ensureSpace(ctx, 340);
  const d = ctx.doc;
  const x = PAGE.MARGIN;
  const y = ctx.y;
  const w = PAGE.W - PAGE.MARGIN * 2;
  const h = 310;

  // Outer frame
  d.setFillColor('#0a0a0a');
  d.setDrawColor(COLOR.ACCENT);
  d.setLineWidth(1.5);
  d.rect(x, y, w, h, 'FD');

  // --- 1. Brand bar (top, ~18pt tall) ---
  d.setFillColor(COLOR.ACCENT);
  d.rect(x, y, w, 18, 'F');
  d.setFont('helvetica', 'bold');
  d.setFontSize(8);
  d.setTextColor(COLOR.BLACK);
  d.text('RMPG FLEX  •  DISPATCH', x + 6, y + 12);
  d.text('10:47:22 MT', x + w - 6, y + 12, { align: 'right' });
  // Anchor label
  d.setFillColor(COLOR.ACCENT);
  d.circle(x + w + 12, y + 9, 6, 'F');
  d.setTextColor(COLOR.BLACK);
  d.setFontSize(7);
  d.text('1', x + w + 12, y + 11, { align: 'center' });

  // --- 2. Menu bar ---
  d.setFillColor('#141414');
  d.rect(x, y + 18, w, 14, 'F');
  d.setFont('helvetica', 'normal');
  d.setFontSize(6);
  d.setTextColor('#999999');
  d.text('File  Edit  View  Dispatch  Records  Map  Intel  Admin  Help', x + 6, y + 28);
  d.setFillColor(COLOR.ACCENT);
  d.circle(x + w + 12, y + 25, 6, 'F');
  d.setTextColor(COLOR.BLACK);
  d.setFontSize(7);
  d.text('2', x + w + 12, y + 27, { align: 'center' });

  // --- 3. Icon toolbar ---
  d.setFillColor('#1a1a1a');
  d.rect(x, y + 32, w, 22, 'F');
  // Draw fake icons as small squares
  for (let i = 0; i < 10; i++) {
    d.setFillColor('#2e2e2e');
    d.rect(x + 8 + i * 24, y + 38, 16, 10, 'F');
  }
  d.setFillColor(COLOR.ACCENT);
  d.circle(x + w + 12, y + 43, 6, 'F');
  d.setTextColor(COLOR.BLACK);
  d.setFontSize(7);
  d.text('3', x + w + 12, y + 45, { align: 'center' });

  // --- 4. Active call stack (left panel, big) ---
  const cpY = y + 58;
  const cpH = h - 58 - 28;
  const leftW = w * 0.38;
  d.setFillColor('#050505');
  d.setDrawColor('#2e2e2e');
  d.rect(x, cpY, leftW, cpH, 'FD');
  // Stack header
  d.setFillColor('#141414');
  d.rect(x, cpY, leftW, 14, 'F');
  d.setFont('helvetica', 'bold');
  d.setFontSize(6);
  d.setTextColor(COLOR.ACCENT);
  d.text('ACTIVE CALLS (7)', x + 6, cpY + 10);
  // Fake call rows
  const colors = ['#b91c1c', '#d4a017', '#666666', '#166534', '#666666'];
  for (let i = 0; i < 5; i++) {
    d.setFillColor(colors[i]);
    d.rect(x + 4, cpY + 18 + i * 24, 3, 18, 'F');
    d.setFillColor('#666666');
    d.rect(x + 12, cpY + 22 + i * 24, leftW * 0.6, 2, 'F');
    d.rect(x + 12, cpY + 28 + i * 24, leftW * 0.4, 2, 'F');
  }
  d.setFillColor(COLOR.ACCENT);
  d.circle(x - 12, cpY + 30, 6, 'F');
  d.setTextColor(COLOR.BLACK);
  d.setFontSize(7);
  d.text('4', x - 12, cpY + 32, { align: 'center' });

  // --- 5. Map + unit overlay (center/right top) ---
  const mapX = x + leftW + 2;
  const mapW = w - leftW - 2;
  const mapH = cpH * 0.6;
  d.setFillColor('#111827');
  d.setDrawColor('#2e2e2e');
  d.rect(mapX, cpY, mapW, mapH, 'FD');
  // Fake beat lines
  d.setDrawColor('#374151');
  d.setLineWidth(0.4);
  for (let i = 1; i < 6; i++) d.line(mapX + (mapW / 6) * i, cpY, mapX + (mapW / 6) * i, cpY + mapH);
  for (let j = 1; j < 4; j++) d.line(mapX, cpY + (mapH / 4) * j, mapX + mapW, cpY + (mapH / 4) * j);
  // Unit dots
  d.setFillColor('#166534'); d.circle(mapX + 30, cpY + 40, 3, 'F');
  d.setFillColor('#d4a017'); d.circle(mapX + 80, cpY + 60, 3, 'F');
  d.setFillColor('#b91c1c'); d.circle(mapX + 140, cpY + 30, 3, 'F');
  d.setFillColor('#166534'); d.circle(mapX + 50, cpY + 80, 3, 'F');
  d.setFillColor(COLOR.ACCENT);
  d.circle(mapX + mapW + 12, cpY + mapH / 2, 6, 'F');
  d.setTextColor(COLOR.BLACK);
  d.setFontSize(7);
  d.text('5', mapX + mapW + 12, cpY + mapH / 2 + 2, { align: 'center' });

  // --- 6. Unit roster (right, below map) ---
  const rosterY = cpY + mapH + 2;
  const rosterH = cpH - mapH - 2;
  d.setFillColor('#050505');
  d.setDrawColor('#2e2e2e');
  d.rect(mapX, rosterY, mapW, rosterH, 'FD');
  d.setFillColor('#141414');
  d.rect(mapX, rosterY, mapW, 12, 'F');
  d.setFont('helvetica', 'bold');
  d.setFontSize(6);
  d.setTextColor(COLOR.ACCENT);
  d.text('UNITS (12 AVAIL / 4 BUSY)', mapX + 6, rosterY + 9);
  // Fake unit chips
  for (let i = 0; i < 8; i++) {
    d.setFillColor(i % 3 === 0 ? '#166534' : (i % 3 === 1 ? '#d4a017' : '#2e2e2e'));
    d.rect(mapX + 6 + (i % 4) * (mapW / 4 - 2), rosterY + 16 + Math.floor(i / 4) * 14, mapW / 4 - 10, 10, 'F');
  }
  d.setFillColor(COLOR.ACCENT);
  d.circle(mapX + mapW + 12, rosterY + rosterH / 2, 6, 'F');
  d.setTextColor(COLOR.BLACK);
  d.setFontSize(7);
  d.text('6', mapX + mapW + 12, rosterY + rosterH / 2 + 2, { align: 'center' });

  // --- 7. Command line (bottom strip above status bar) ---
  const cmdY = y + h - 28;
  d.setFillColor('#000000');
  d.setDrawColor(COLOR.ACCENT);
  d.setLineWidth(0.75);
  d.rect(x, cmdY, w, 14, 'FD');
  d.setFont('courier', 'bold');
  d.setFontSize(7);
  d.setTextColor(COLOR.ACCENT);
  d.text('CMD>  U07 10-97', x + 6, cmdY + 10);
  d.setFillColor(COLOR.ACCENT);
  d.circle(x - 12, cmdY + 7, 6, 'F');
  d.setTextColor(COLOR.BLACK);
  d.setFontSize(7);
  d.text('7', x - 12, cmdY + 9, { align: 'center' });

  // --- 8. Status bar (very bottom) ---
  const sbY = y + h - 14;
  d.setFillColor('#141414');
  d.rect(x, sbY, w, 14, 'F');
  d.setFont('helvetica', 'normal');
  d.setFontSize(6);
  d.setTextColor('#888888');
  d.text('P1:1  P2:2  AVAIL:12  BUSY:4  |  F2 New  F3 Disp  F5 Enr  F6 Scn  F7 Clr', x + 6, sbY + 10);
  d.setTextColor('#166534');
  d.text('● LIVE', x + w - 30, sbY + 10);
  d.setFillColor(COLOR.ACCENT);
  d.circle(x + w + 12, sbY + 7, 6, 'F');
  d.setTextColor(COLOR.BLACK);
  d.setFontSize(7);
  d.text('8', x + w + 12, sbY + 9, { align: 'center' });

  ctx.y += h + 20;

  // Caption
  d.setFont('helvetica', 'italic');
  d.setFontSize(8);
  d.setTextColor(COLOR.MUTED);
  d.text('Fig. 20-1 — Dispatch console anatomy, with numbered regions referenced below.', x, ctx.y);
  ctx.y += 12;
}

function section20(ctx: GuideContext): void {
  title(ctx, '20. Anatomy of the Console');

  paragraph(ctx,
    'This section walks the console from top to bottom, region by region, so you know the name and purpose of every element a supervisor or trainer might point at. The numbered regions in the figure below correspond to the eight subsections that follow. Nothing here is operational — this is orientation.',
  );

  drawConsoleAnatomyDiagram(ctx);

  h2(ctx, 'Region 1 — Brand Bar');
  paragraph(ctx,
    'The top 52-pixel strip is the brand bar: gold background, agency name on the left, current time (America/Denver, Mountain Time, never UTC) on the right. The time display is the server\'s time, not your workstation\'s clock — if the two ever disagree, the server wins, because that is the clock that stamps every call, transition, and audit entry. If the brand bar flashes red briefly, the workstation has detected more than 2 seconds of clock drift and is forcing an NTP resync.',
  );

  h2(ctx, 'Region 2 — Menu Bar');
  paragraph(ctx,
    'A traditional desktop menu (File, Edit, View, Dispatch, Records, Map, Intelligence, Admin, Help). Everything in the console is reachable from here, even things that also have a hotkey or toolbar icon. Menus are organized by noun (what you want to act on), not verb (what you want to do). Examples:',
  );
  bullet(ctx, 'Dispatch -> New Call opens the intake form. Same as F2.');
  bullet(ctx, 'Records -> Search opens compound search. Same as Ctrl+Shift+F.');
  bullet(ctx, 'Help -> Dispatch Guide (PDF) downloads this document — now you know where it came from.');
  bullet(ctx, 'Admin is only visible to admin / manager / supervisor roles; officer and dispatcher roles will not see it in the bar at all.');

  h2(ctx, 'Region 3 — Icon Toolbar');
  paragraph(ctx,
    'The icon toolbar mirrors the most-used actions as single-click buttons: New Call, Dispatch Selected, Mark Enroute, Mark On Scene, Clear, CMD Line, Map, Roster, Records. Hovering any icon shows both its name and its hotkey, so the toolbar doubles as a hotkey-learning tool for new dispatchers. Once you know the F-keys you will not use this toolbar often, but during the first week it is how you discover what is available.',
  );

  h2(ctx, 'Region 4 — Active Call Stack');
  paragraph(ctx,
    'The left panel lists every unclosed call, sorted by priority then by age. Each row has a colored priority bar on the left (red=P1, amber=P2, gray=P3, green=P4), call number, incident type, status chip, assigned units, and elapsed time. Clicking a row selects it; selected call becomes the target of subsequent F-key presses. The selected call also highlights on the map and pulses its markers.',
  );
  paragraph(ctx,
    'The call stack is real-time. A new call created by another dispatcher appears here within roughly one second, with a subtle gold flash animation so you notice new additions without them being disruptive. Calls that change priority mid-incident (e.g. an upgrade from P3 disturbance to P1 shots-fired) animate their priority bar transition so the change is visually unmistakable.',
  );

  h2(ctx, 'Region 5 — Map + Unit Overlay');
  paragraph(ctx,
    'The center/right top area is the live map. By default it shows the dark_matter basemap with beat polygons colored by sector, active calls as pinned incident-type icons, and units as dots colored by status. The map is pannable, zoomable, and rotatable. Clicking a unit dot opens a quick-info popup with call sign, current status, last-known location timestamp, and a button to dispatch that unit to the selected call.',
  );
  paragraph(ctx,
    'Under the hood this is Google Maps with a styled dark palette; when the Google API fails (billing, quota, or network), the map transparently falls back to offline CartoDB tiles pre-cached for the Utah operational area. You will usually not know the difference, but a small "OFFLINE TILES" badge appears in the corner when the fallback is active.',
  );

  h2(ctx, 'Region 6 — Unit Roster');
  paragraph(ctx,
    'Below the map, the roster shows every unit on the current shift as a status chip: call sign, badge number, current status, last-transition time. Chips are color-coded: green=available, amber=dispatched/enroute, red=on scene or busy, gray=off duty. Clicking a chip selects that unit; right-clicking opens a context menu with every legal status transition. The roster respects the server-side transition rules (see Section 3) — illegal transitions are grayed out, not rejected with an error.',
  );

  h2(ctx, 'Region 7 — Command Line');
  paragraph(ctx,
    'Above the status bar sits the CAD command line — a single-line text input with a terminal-style gold caret on black. This is the fastest way to act on calls and units once you know the shorthand (Section 6). Everything you can do in the menus or with F-keys, you can also do here with fewer keystrokes. The command line has tab-completion for unit call signs and call numbers, command history (up-arrow), and a response area that shows the result of the last command.',
  );

  h2(ctx, 'Region 8 — Status Bar');
  paragraph(ctx,
    'The bottom 22-pixel strip is permanent situational awareness. Left side: live P1 / P2 counts, available / busy unit totals. Center: F-key hints for current context. Right side: WebSocket connection indicator (green LIVE LED when connected, red OFFLINE LED when not — see Section 14). Never hide this strip; it is the fastest way to spot that the console is losing sync before the rest of the UI shows it.',
  );

  calloutBox(ctx, 'Orientation Exercise',
    'On your first shift, spend ten minutes clicking through every region while nothing is happening. Open a menu, hover every toolbar icon, click a call row and watch the map center, click a unit chip and watch the roster highlight. Muscle memory for the console geography is more valuable than any 10-code memorization.',
    'info',
  );
}

function section21(ctx: GuideContext): void {
  title(ctx, '21. Worked Example — A Shots-Fired Call, End to End');

  paragraph(ctx,
    'This section walks a complete, realistic call from the moment the phone rings to the moment everyone clears. Every keystroke, every radio exchange, every console state change is shown. Read it once to build a mental model of "what a whole call looks like," then use it as a benchmark when you run your own calls.',
  );

  drawCallTimelineDiagram(ctx);

  h2(ctx, 'The Scenario');
  paragraph(ctx,
    '21:47 Mountain Time on a Friday. You are the sole dispatcher on the night watch. A 911 call rings in on console line 1 from a caller at a gas station near 2100 South State Street. Caller reports two subjects in a verbal altercation in the parking lot, one has just produced a handgun, and there has been one round fired into the air. No injuries reported. Caller is hiding inside the store.',
  );

  h2(ctx, 'T+00:00 — Ring-Down');
  paragraph(ctx,
    'Phone rings. You answer with the standard agency greeting: "RMPG Dispatch, recorded line, what is your emergency?" Simultaneously you press F2 — the intake form opens on your second monitor and begins recording the call automatically.',
  );
  bullet(ctx, 'F2 opens intake form. Cursor is in the Location field.');
  bullet(ctx, 'Timer on the intake form starts the moment F2 is pressed. This becomes the call creation time.');
  bullet(ctx, 'The caller ANI/ALI (if available from the SIP trunk) auto-populates the reporting party phone number.');

  h2(ctx, 'T+00:03 to T+00:20 — Pulling Information');
  paragraph(ctx,
    'Caller gives the location. You type "2100 S State" into the Location field; autocomplete offers "2100 S State St, Salt Lake City, UT" — you arrow-down and Tab to accept. Map pans to the address and drops a pending-call pin. You ask: "What is happening right now?" Caller: "There are two guys fighting, one has a gun, he shot it once into the sky." You do not paraphrase. You type verbatim into the Description: "RP reports two male subjects in verbal altercation, one has produced handgun and fired one round into air. No reported injuries."',
  );
  paragraph(ctx,
    'You ask three more questions in order of safety value: (1) "Is anyone hurt?" — No. (2) "Where is the subject with the gun right now?" — Still in the parking lot, pacing. (3) "Can you safely stay on the line?" — Yes, I\'m behind the counter. You do NOT ask for the caller\'s full name or DOB at this stage; that can wait until units are dispatched.',
  );

  h2(ctx, 'T+00:22 — Classifying & Dispatching');
  paragraph(ctx,
    'You click the Incident Type field, type "shot" — autocomplete surfaces "Shots Fired" (Signal-3). You press Tab to accept. The form auto-applies the default for Signal-3: Priority 1, flags WEAPON and OFFICER_SAFETY. The form asks "Confirm P1 and 2-unit backup rule?" — you click Confirm. The moment you confirm, the call is saved and broadcast to every workstation and MDT. On your own screen, the new call row slides in at the top of the call stack with a red priority bar and a pulsing border.',
  );
  calloutBox(ctx, 'The Two-Question Rule',
    'For any weapon call, the two questions you MUST answer before continuing information-gathering are: "Is anyone hurt?" and "Where is the weapon right now?" Everything else can wait 30 seconds while you dispatch units.',
    'warn',
  );

  h2(ctx, 'T+00:25 — Voice Channel Alert');
  paragraph(ctx,
    'The Dispatcher Brain voice engine speaks the call on the dispatch channel automatically, in a calm radio voice: "Attention all units, priority 1 shots fired, 2100 South State. Two subjects, one armed, one round fired into the air. No injuries reported. Requesting two-unit response." This broadcasts at the same time as the visual alert, so officers hear and see simultaneously. Units closest to the call receive a distinctive priority tone first — a three-note ascending pattern — not the normal two-tone.',
  );

  h2(ctx, 'T+00:28 — First Acknowledgment');
  paragraph(ctx,
    'Radio: "U07, show me enroute, I\'m southbound on State at 21st South." You click U07 in the roster and press F5 (Enroute). The chip turns amber, the unit dot on the map begins moving toward the call, and the ETA estimate appears. Time-to-enroute was 3 seconds — excellent.',
  );
  paragraph(ctx,
    'Radio: "U12, I\'m copying, I\'m two blocks east, enroute." You click U12, press F5. U12 is now also amber. Two units enroute to a P1 weapon call — backup rule satisfied.',
  );

  h2(ctx, 'T+00:58 — Second Update From Caller');
  paragraph(ctx,
    'While units are moving, you stay on the line with the caller. Caller: "The guy with the gun just got into a black pickup truck, it looks like a Chevy, older model, and he\'s leaving. He went north on State." You immediately type into Description: "UPDATE T+58 — subject with handgun departed NB State in older-model black Chevy pickup, direction of travel north." You press Enter; the update broadcasts to every MDT and re-speaks to the voice channel.',
  );
  paragraph(ctx,
    'You click the Vehicle tab on the call form, type a partial vehicle record: Make Chevrolet, Color Black, Style Pickup, Direction North from 2100 S State. This populates the call\'s vehicle record and is visible to every responding officer on their MDT within a second.',
  );

  h2(ctx, 'T+01:04 — Units Diverted');
  paragraph(ctx,
    'Radio: "U07, I heard that, I\'m going to post at State and 13th South to intercept." You do not have to do anything — this is an officer tactical decision. You document by typing in your own dispatcher notes: "U07 posting at State/13th to intercept NB pickup." U12 continues to the scene to check on the caller and the other party.',
  );

  h2(ctx, 'T+01:48 — On Scene');
  paragraph(ctx,
    'Radio: "U12, 10-97 at the Chevron." You click U12, press F6 (On Scene). Chip turns red, map dot freezes at the location with a small "ON SCENE" label. Dispatcher Brain note: the rule engine starts an 8-minute stuck-check timer on U12.',
  );

  h2(ctx, 'T+02:30 — BOLO Broadcast');
  paragraph(ctx,
    'You now have enough to push a BOLO. You press F8 to open the command line and type: "BOLO NB STATE BLK CHEV PU POSS HANDGUN, NO PLATE, LRM IN AREA OF 2100 S STATE T-3 MIN". Press Enter. The BOLO broadcasts to every MDT, to the dispatch channel voice, and to adjacent agencies via the inter-agency BOLO relay (SLCPD, UHP, Unified PD).',
  );

  h2(ctx, 'T+03:15 — Supplemental Caller Info');
  paragraph(ctx,
    'Caller, still on the line, tells you the subject with the gun was "about six foot, wearing a red hoodie, black pants, maybe 25 years old." You add a person record to the call: Unknown Male, DESC red hoodie black pants H/6-0 appx age 25. This auto-updates the BOLO with a subject description; the updated BOLO re-speaks on the voice channel and re-pushes to MDTs.',
  );

  h2(ctx, 'T+04:42 — Second Unit On Scene');
  paragraph(ctx,
    'Radio: "U07, 10-97 at State and 13th, no contact on the vehicle, I\'ll standby at this location for 15." You click U07, press F6. Both units are on scene. The dispatcher note field gets: "U07 posting at State/13th x 15 min for BOLO interception."',
  );

  h2(ctx, 'T+12:30 — U12 Clears');
  paragraph(ctx,
    'Radio: "U12, 10-98, spoke with the other subject and the RP, no injuries, will file an FI on the second subject and a supplemental on this call, show me available." You click U12, press F7 (Clear). Chip turns green, map dot resumes normal movement. The call stays open because U07 is still posted and the BOLO is active.',
  );

  h2(ctx, 'T+20:15 — U07 Clears');
  paragraph(ctx,
    'Radio: "U07, negative contact on the vehicle after 15 minutes, going 10-8." You click U07, F7. The call now has zero assigned units. The call row in the stack turns gray with an "UNSTAFFED — BOLO ACTIVE" flag.',
  );

  h2(ctx, 'T+20:30 — Close Out');
  paragraph(ctx,
    'You review the call one last time: description complete, vehicle record attached, person record attached, both units documented with their arrival and clearance times, BOLO is active and persistent. You click Close Call — the dialog asks for Disposition. You choose "GOA — Gone on Arrival, BOLO Active." The call moves from Active to Closed. The BOLO remains active for the shift and will auto-expire at 08:00 unless renewed.',
  );

  h2(ctx, 'Post-Call Review');
  paragraph(ctx,
    'After the call closes, take 30 seconds for self-review: Did I dispatch within 45 seconds of the first ring? (3 seconds to enroute — yes.) Did I get the weapon location before dispatching? (Yes, with the pacing detail.) Did I update the call with every new piece of info? (Yes, three updates.) Did I push the BOLO as soon as I had enough? (~2 minutes after first ring — yes.) These five questions, run after every significant call, are what separate a working dispatcher from a great one.',
  );
}

function section22(ctx: GuideContext): void {
  title(ctx, '22. Your First Shift — New Dispatcher Onboarding');

  paragraph(ctx,
    'This section is for dispatchers on their first solo shift or first shift after certification. Senior dispatchers may skip it. Everything here is about the first 60 minutes: what to do, what order, and what to do BEFORE the first call comes in so you are ready.',
  );

  h2(ctx, 'The First 15 Minutes');
  bullet(ctx, 'Log in to the console. Verify your display name and role in the status bar bottom-right. If it says anything other than your name, DO NOT PROCEED — get a supervisor.');
  bullet(ctx, 'Check the call stack for overnight / carryover calls. Read each one. If you do not understand a call, ask the outgoing dispatcher before they leave.');
  bullet(ctx, 'Check the unit roster: who is on duty, who is off, who is posted (assigned to a specific location), who is available.');
  bullet(ctx, 'Scan the BOLO panel (F11). Know what vehicles and persons are active — one of them may drive past a unit during your shift.');
  bullet(ctx, 'Verify the voice channel is armed: press F10, speak a test phrase, listen for the synthesized playback.');
  bullet(ctx, 'Check the WebSocket LIVE indicator in the status bar is green.');

  h2(ctx, 'The Next 15 Minutes — Practice the Console');
  paragraph(ctx,
    'If no calls are active, spend this time on deliberate practice, not social chat with your partner:',
  );
  bullet(ctx, 'Press F2 to open the intake form, look at every field, press Escape to cancel.');
  bullet(ctx, 'Press F8, type "LE 29" — verify the 10-code popup shows "Want/warrant check".');
  bullet(ctx, 'Click a unit chip, right-click, look at every status transition.');
  bullet(ctx, 'Open the map, zoom to your operational area, pan around. Find the beat labels.');
  bullet(ctx, 'Open Records -> Search, do a test compound search for your own name. Should return your user record.');

  h2(ctx, 'The First 30 Minutes — Mental Model');
  paragraph(ctx,
    'Before the first real call comes in, rehearse the flow in your head. For each of the following scenarios, talk through what you would do out loud (or silently to yourself):',
  );
  bullet(ctx, 'A disturbance call at a residence, no weapons mentioned.');
  bullet(ctx, 'A traffic stop where the officer radios the plate before you have a call open.');
  bullet(ctx, 'A BOLO hit — an officer spots a vehicle matching an active BOLO.');
  bullet(ctx, 'An officer does not respond to two consecutive radio checks.');
  bullet(ctx, 'A 911 hang-up with an ANI/ALI but no voice.');
  paragraph(ctx,
    'The goal is not to have a perfect answer to each; the goal is that the muscle memory is warm when the real thing happens. The first call of the shift is always the slowest one.',
  );

  h2(ctx, 'Things New Dispatchers Commonly Get Wrong');
  bullet(ctx, 'Paraphrasing the caller. Do not. Type what they said. "He has a gun" is different from "suspect is armed."');
  bullet(ctx, 'Waiting for all the information before dispatching. Dispatch with what you have. Updates come later.');
  bullet(ctx, 'Treating a 10-29 as a formality. It is not. A wanted-persons check on a traffic stop can change the call from ticket to felony stop in two seconds.');
  bullet(ctx, 'Stepping on radio traffic. When an officer is transmitting, wait. The console will buffer your announcement and speak it when the channel clears.');
  bullet(ctx, 'Clearing a call too early. A call is not cleared when the officer leaves the scene — it is cleared when the incident is resolved and everything is documented.');
  bullet(ctx, 'Not asking for help. The senior dispatcher next to you has run the call you are on a hundred times. Asking is faster than guessing.');

  h2(ctx, 'The Three Questions');
  paragraph(ctx,
    'When you are overwhelmed on a call, come back to these three questions in order:',
  );
  bullet(ctx, '1. Is anyone in immediate danger? If yes, prioritize their safety — dispatch more units, push an emergency tone, whatever it takes.');
  bullet(ctx, '2. Do responding officers have what they need to be safe? If no, get it: weapon description, subject location, vehicle direction.');
  bullet(ctx, '3. Is this call documented? If no, type it in. If you did not type it, it did not happen.');

  calloutBox(ctx, 'Mindset',
    'Dispatching is a skill that takes two years to become competent at and ten to master. On your first shift, you are allowed to be slow. You are not allowed to be silent. Talk on the radio, narrate in the notes, ask questions out loud. Silence is where errors hide.',
    'info',
  );
}

// ═══════════════════════════════════════════════════════════
// Section 23 — "How To Use" activation guides. Each subsystem
// gets a step-by-step enable / operate / troubleshoot recipe
// a dispatcher can follow the first time they touch it.
// Reads like a cookbook, not a reference — every recipe is
// self-contained and written in the imperative.
// ═══════════════════════════════════════════════════════════

function section23(ctx: GuideContext): void {
  title(ctx, '23. How To Use — Activating AI & Subsystems');

  paragraph(ctx,
    'Sections 1-22 explain what the console does. This section explains HOW to turn on the individual features and sub-systems, step by step. Every recipe below is self-contained: the prerequisites are listed, the click path is spelled out, and there is a quick test you can run to confirm it works. Read the recipe that matches the feature you need right now; the others can wait until you do.',
  );

  calloutBox(ctx, 'Orientation',
    'None of these features require a supervisor or admin to enable per-dispatcher. If a recipe below asks for a setting you cannot see, check your user role in the status bar. Some features (audit-log viewing, BOLO broadcast to adjacent agencies, premise-alert creation) require supervisor or admin role — those are called out in the recipe.',
    'info',
  );

  // ───────────────────────────────────────────────────────
  h2(ctx, '23.1 AI Dispatcher Brain — Activation');
  paragraph(ctx,
    'The Dispatcher Brain is the rule-based AI system that watches every call and unit in real time and speaks coaching cues, safety reminders, and stuck-state warnings to you. It is NOT a replacement for judgment — treat it as a very attentive second dispatcher who only speaks when it sees a pattern you asked it to watch for.',
  );

  h3(ctx, 'Prerequisites');
  bullet(ctx, 'Your account has the dispatcher, supervisor, or admin role.');
  bullet(ctx, 'Your workstation has working speakers or headphones and browser audio is not muted.');
  bullet(ctx, 'The WebSocket LIVE indicator in the status bar is green. Brain needs live events to fire rules.');

  h3(ctx, 'Enable Steps');
  bullet(ctx, 'Click your name in the top-right corner of the console. The user menu drops down.');
  bullet(ctx, 'Select User Profile. The profile panel opens.');
  bullet(ctx, 'Click the Voice tab along the top of the profile panel.');
  bullet(ctx, 'Find the "Dispatcher Brain" toggle. Flip it ON. A green "Brain Active" badge appears in the status bar.');
  bullet(ctx, 'Choose a Terseness preset: Narrative (full sentences, best for training), Standard (clipped professional phrasing, default), or Terse (5-word prompts, best for veterans who know the console cold).');
  bullet(ctx, 'Optional: set Voice Gender (Jenny / Guy / Aria), Speaking Rate (0.8x to 1.3x of normal), and which rule categories fire — Safety, Timer, Coaching, Context, Events.');
  bullet(ctx, 'Click Save. The brain immediately speaks a test line: "Dispatcher Brain active. I will notify you when something needs attention."');

  h3(ctx, 'Verify');
  bullet(ctx, 'Create a test call (F2) with priority P1. Brain should speak "Priority 1 dispatched. Two-unit rule engaged." within 2 seconds of save.');
  bullet(ctx, 'Close the test call with disposition UNFOUNDED.');

  h3(ctx, 'Turn Off');
  bullet(ctx, 'Same path — User Profile -> Voice tab -> Dispatcher Brain toggle OFF. Or press Ctrl+Shift+B for an instant mute without losing your preset settings.');

  calloutBox(ctx, 'Common Mistake',
    'If you hear nothing when the brain should be speaking, first check the master sound toggle in the status bar — it can mute ALL audio including brain, voice alerts, and radio tones. The Brain Active badge will still show green even when the master mute is on.',
    'warn',
  );

  // ───────────────────────────────────────────────────────
  h2(ctx, '23.2 Voice Dictation — Call Intake By Speaking');
  paragraph(ctx,
    'You can populate a call intake form by speaking rather than typing. Useful when you are on the phone with a caller and want to keep both hands free, or when you are a slower typist than you are a listener. Voice dictation uses the browser\'s Web Speech API plus a CAD-specific vocabulary model that recognizes Utah street names, 10-codes, and standard incident types.',
  );

  h3(ctx, 'Prerequisites');
  bullet(ctx, 'Chrome, Edge, or any Chromium-based browser. Firefox and Safari fall back to the default Web Speech recognizer which is notably less accurate on CAD vocabulary.');
  bullet(ctx, 'Microphone permission granted to the console domain (rmpgutah.us). If you have never used the mic before, the browser will prompt the first time you press V.');

  h3(ctx, 'Use');
  bullet(ctx, 'Press F2 to open the intake form.');
  bullet(ctx, 'Press V (for Voice). A red recording indicator appears in the top-right of the intake form.');
  bullet(ctx, 'Speak naturally: "Shots fired at 2100 South State Street, two subjects, one armed, one round fired into the air." The form populates Incident Type (Shots Fired), Location (auto-geocoded), and Description (verbatim transcript) as you speak.');
  bullet(ctx, 'Press V again to stop recording. Review the populated fields and edit any misheard words.');
  bullet(ctx, 'Press Enter to save. Dispatch proceeds normally.');

  h3(ctx, 'Transcript Review');
  paragraph(ctx,
    'Press T on any open call to see the full voice transcript for that call — every speak-to-call interaction, timestamped and attributable. This is the official record of what you said into the mic; the dispatcher brain uses it for coaching and the supervisor uses it for QA review.',
  );

  calloutBox(ctx, 'Privacy',
    'Voice dictation records audio locally and transmits only the text transcript to the server. Raw audio is NOT stored. However, the transcript IS audited and discoverable — treat your microphone like an open radio channel.',
    'warn',
  );

  // ───────────────────────────────────────────────────────
  h2(ctx, '23.3 BOLO System — Create, Broadcast, Clear');
  paragraph(ctx,
    'A BOLO (Be On the Look-Out) is a persistent broadcast about a person, vehicle, or pattern that stays active across shifts until explicitly cleared or auto-expired. Every officer on duty sees active BOLOs on their MDT the moment they log on.',
  );

  h3(ctx, 'Create');
  bullet(ctx, 'Press F11 (or Dispatch menu -> New BOLO). The BOLO form opens.');
  bullet(ctx, 'Choose BOLO Type: Vehicle, Person, Pattern (e.g. "series of garage burglaries"), or Property (stolen item).');
  bullet(ctx, 'Fill in known details. Leave unknowns blank — partial BOLOs are better than no BOLOs.');
  bullet(ctx, 'Set safety flags if applicable: WEAPON, FELONY, KNOWN_GANG, OFFICER_SAFETY, JUVENILE. Flags drive the priority tone officers hear when the BOLO broadcasts.');
  bullet(ctx, 'Set expiration: default 8 hours (end of shift), override for up to 72 hours with supervisor approval.');
  bullet(ctx, 'Set Agency Scope: RMPG only (default), RMPG + SLCPD (metro relay), or RMPG + UHP + Unified PD + SLCPD (valley-wide).');
  bullet(ctx, 'Click Broadcast. Voice channel speaks the BOLO immediately, MDTs pop a BOLO card, and the BOLO appears in the F11 BOLO panel on every workstation.');

  h3(ctx, 'Amend');
  bullet(ctx, 'From the BOLO panel, click the BOLO row. Click Amend (not Edit — amendments are versioned).');
  bullet(ctx, 'Add or update fields. Every amendment re-broadcasts with an "UPDATED BOLO" prefix so officers know to re-read.');

  h3(ctx, 'Clear');
  bullet(ctx, 'When the subject is located, arrested, or the pattern stops, clear the BOLO: click the BOLO row, click Clear, choose a disposition (SUBJECT IN CUSTODY, VEHICLE RECOVERED, PATTERN RESOLVED, EXPIRED UNRESOLVED).');
  bullet(ctx, 'Cleared BOLOs stay in the searchable history forever; they just stop broadcasting and drop off the active panel.');

  // ───────────────────────────────────────────────────────
  h2(ctx, '23.4 Premise Alerts — Creating and Using');
  paragraph(ctx,
    'A premise alert is a persistent warning tied to a specific address. Examples: "known aggressive dog," "wheelchair-bound resident," "prior DV at this location," "known meth lab — HAZMAT protocols." When any call is dispatched to that address, the alert surfaces automatically on the call form and is voice-announced to responding officers.',
  );

  h3(ctx, 'Create (Requires Supervisor Role)');
  bullet(ctx, 'From the map or the Records -> Addresses page, find the address.');
  bullet(ctx, 'Click the address pin. Click Add Premise Alert.');
  bullet(ctx, 'Choose alert severity: INFO (gray, informational only — "cameras on property"), CAUTION (amber, officer-safety advisory — "aggressive dog"), or WARNING (red, serious — "known violent subject, weapons at location").');
  bullet(ctx, 'Write the alert text. Keep it under 80 characters — it will be spoken on the voice channel, so brevity is clarity.');
  bullet(ctx, 'Optional: set an expiration date. Default is no expiration (persistent).');
  bullet(ctx, 'Click Save. The alert is immediately live on any future dispatch to that address.');

  h3(ctx, 'How It Surfaces');
  bullet(ctx, 'When you type an address into a new call, if that address has one or more premise alerts, a red/amber/gray banner appears at the top of the intake form with the alert text.');
  bullet(ctx, 'The voice channel speaks the alert as part of the dispatch announcement: "Priority 2 disturbance, 1234 Example Ave. Premise warning: aggressive dog at this location."');
  bullet(ctx, 'MDTs display a full-screen premise card that the officer must dismiss before they can acknowledge the call. This is intentional friction — life-safety information should be impossible to skip past.');

  h3(ctx, 'Review and Retire');
  paragraph(ctx,
    'Premise alerts need periodic review. A "wheelchair-bound resident" alert from 2018 may be stale if the resident moved. Supervisors should review and retire obsolete alerts quarterly under Records -> Premise Alerts -> Review Queue.',
  );

  // ───────────────────────────────────────────────────────
  h2(ctx, '23.5 NCIC Queries — Wants, Warrants, Stolen Property');
  paragraph(ctx,
    'NCIC is the FBI\'s national crime information center. RMPG is configured as a secondary operator with read-only query access (we can ask NCIC questions; we cannot enter records into NCIC). Use NCIC for any person, vehicle, plate, firearm, or article check that may have a federal or cross-jurisdictional dimension.',
  );

  h3(ctx, 'Run a Query');
  bullet(ctx, 'Press F12 to open the NCIC query panel. The panel defaults to Person query.');
  bullet(ctx, 'Choose query type: Person (by name + DOB), Vehicle (by VIN or by plate+state), Article (by serial number), Firearm (by serial + make), Plate (partial or full).');
  bullet(ctx, 'Fill in the fields. Person queries require at a minimum a last name AND either DOB or a first name and approximate age.');
  bullet(ctx, 'Click Run Query. Responses typically return in 2-4 seconds; during peak federal load it can take up to 15 seconds.');

  h3(ctx, 'Reading Responses');
  bullet(ctx, 'NO HIT — no matching record. This is NOT the same as "clear" — you only asked one question, and NCIC only answers what it has.');
  bullet(ctx, 'HIT — one or more matching records. Read the hit: ORI (originating agency), record type (wanted, missing, sex offender, protection order), caveats, and any special instructions.');
  bullet(ctx, 'VERIFY — NCIC hits MUST be verified with the originating agency before acting. The console auto-sends a hit-confirmation request; do not make officer-safety decisions on the hit alone until verified.');

  calloutBox(ctx, 'Misuse',
    'NCIC access is federally audited. Every query is logged with your user ID, timestamp, justification (which you are required to enter for each query: incident number or case number). Running NCIC on a person for non-law-enforcement reasons is a federal crime under 18 U.S.C. 1030. Do not help friends, family, or curious acquaintances run "just one quick check" — the audit trail is forever.',
    'warn',
  );

  // ───────────────────────────────────────────────────────
  h2(ctx, '23.6 Live GPS Breadcrumbs — Unit Tracking');
  paragraph(ctx,
    'Every unit with an MDT or a mobile-app session broadcasts GPS approximately every 5 seconds while in service. The breadcrumb trail — the unit\'s path over the last N minutes — is available for review and replay.',
  );

  h3(ctx, 'View Breadcrumbs');
  bullet(ctx, 'Click a unit on the map. The quick-info popup opens.');
  bullet(ctx, 'Click "Breadcrumbs" in the popup. The unit\'s last 30 minutes of movement draws on the map as a fading blue trail.');
  bullet(ctx, 'Adjust the time window: 15 minutes, 30 minutes, 1 hour, entire shift.');
  bullet(ctx, 'Click Play to animate the movement in sped-up playback — useful for post-incident reconstruction.');

  h3(ctx, 'When to Use');
  bullet(ctx, 'Welfare check on a non-responsive officer: where have they been in the last 5 minutes?');
  bullet(ctx, 'Pursuit debrief: reconstruct the chase path for the supervisor report.');
  bullet(ctx, 'Posted-unit verification: did the unit actually go to the post, or just report "on post" from the parking lot across the street?');
  bullet(ctx, 'Training review: new-officer patrol-coverage evaluation over a shift.');

  // ───────────────────────────────────────────────────────
  h2(ctx, '23.7 Skip Tracer V2 — Running a Lookup');
  paragraph(ctx,
    'Skip Tracer V2 consolidates 22 public and agency data sources into a single query interface. Use for deep background, stale-address investigation, or pre-dispatch context on a high-risk subject.',
  );

  h3(ctx, 'Open the Tool');
  bullet(ctx, 'Intelligence menu -> Skip Tracer, or the keyboard shortcut Ctrl+Shift+S.');
  bullet(ctx, 'The search form opens. Required: at least a last name OR a phone number OR an address.');

  h3(ctx, 'Required Justification');
  bullet(ctx, 'Every skip trace requires a case number or incident number in the Justification field. The form will not submit without one.');
  bullet(ctx, 'If the lookup is for proactive intelligence with no open case, use "INTEL-" prefix followed by your initials and date (e.g. INTEL-JS-2026-04-20). Supervisors review INTEL prefixes for pattern abuse.');

  h3(ctx, 'Running');
  bullet(ctx, 'Fill the form, click Run. The query fans out to all 22 sources in parallel.');
  bullet(ctx, 'Results stream in as sources respond — NSOPW is usually fastest (<2s), federal sanctions take 5-10s, SLC Assessor can take 30s on cold queries.');
  bullet(ctx, 'Results are deduplicated across sources and grouped by confidence: HIGH (multiple sources corroborate), MEDIUM (single authoritative source), LOW (single weak source, e.g. social directory).');

  h3(ctx, 'Interpreting Hits');
  bullet(ctx, 'FBI WANTED hit: treat as armed and dangerous until verified. Notify supervisor immediately.');
  bullet(ctx, 'OFAC Sanctions hit: likely a false positive on a common name. Verify by DOB and photo before acting.');
  bullet(ctx, 'NSOPW hit: registered sex offender. Note any address-of-record mismatch — that itself may be a registration violation.');
  bullet(ctx, 'Utah Court hit: active or recent case. Open the court record for charge specifics and next-hearing date.');

  // ───────────────────────────────────────────────────────
  h2(ctx, '23.8 Compound Search — Building a Query');
  paragraph(ctx,
    'Compound Search (Records -> Search -> Compound, or Ctrl+Shift+F) is the NCIC-style structured query form. Use it when you need records that match multiple criteria simultaneously.',
  );

  h3(ctx, 'Example — Build This Query');
  paragraph(ctx,
    'Scenario: an officer just cleared a call and wants to know if a subject named "Smith" in their late 30s has been contacted in Beat 14 in the last 60 days.',
  );
  bullet(ctx, 'Open compound search (Ctrl+Shift+F).');
  bullet(ctx, 'Name: Smith* (wildcard suffix catches Smithson, Smithers, etc.).');
  bullet(ctx, 'DOB: range, 1985-01-01 to 1990-12-31 (gives "late 30s in 2026").');
  bullet(ctx, 'Location: Beat 14 (click Beat from the drop-down, select 14).');
  bullet(ctx, 'Date range: 2026-02-20 to 2026-04-20 (last 60 days).');
  bullet(ctx, 'Record types: check Calls, Incidents, Field Interviews (the three that geotag to a beat).');
  bullet(ctx, 'Click Run. Results group by record type; click through to each.');

  h3(ctx, 'Save for Reuse');
  bullet(ctx, 'Click Save Search at the top of the query form. Name it (e.g. "Late-30s Smiths in Beat 14").');
  bullet(ctx, 'Saved searches live under Records -> Saved Searches and are per-user (not shared).');
  bullet(ctx, 'Running a saved search re-executes against CURRENT data, so "Calls in Beat 14 this week" works every week without re-editing.');

  // ───────────────────────────────────────────────────────
  h2(ctx, '23.9 Offline Tile Pre-cache — Before a Long Deployment');
  paragraph(ctx,
    'Before a planned event with limited connectivity (parade detail, festival, remote tactical operation), pre-cache map tiles for the operational area so the map continues to work without network. The service worker auto-caches tiles you pan over, but you can force a deeper cache for a specific bounding box.',
  );

  h3(ctx, 'Steps');
  bullet(ctx, 'Open the map. Pan to the event area.');
  bullet(ctx, 'Tools menu -> Pre-cache Map Area. A rectangle overlay appears.');
  bullet(ctx, 'Drag the rectangle to cover the area. Choose zoom levels to cache: typically Z10 (overview) to Z17 (street detail). Z18-19 adds significant time and cache size.');
  bullet(ctx, 'Click Pre-cache. A progress bar shows tile download. Typical 1-square-mile area at Z10-Z17 = ~500 tiles = ~20MB, takes 30-90 seconds.');
  bullet(ctx, 'Verify: turn off your network (airplane mode on a laptop) and pan around the cached area. Tiles load from cache.');

  h3(ctx, 'Cache Eviction');
  bullet(ctx, 'The service worker enforces a max-tile-cache size (default 1GB). Tiles you have not used in 30 days get evicted first.');
  bullet(ctx, 'To force-evict everything and rebuild: Tools -> Clear Map Cache. Note this also clears your personal tile history and the next shift will start with a cold cache.');

  // ───────────────────────────────────────────────────────
  h2(ctx, '23.10 Dispatcher Brain — Rule Customization');
  paragraph(ctx,
    'The dispatcher brain comes with ~40 pre-configured rules (see Section 7 for categories). You can enable, disable, or threshold-adjust individual rules per your workstation without affecting other dispatchers.',
  );

  h3(ctx, 'Access');
  bullet(ctx, 'User Profile -> Voice tab -> "Edit Rules" at the bottom.');
  bullet(ctx, 'The rule editor opens, grouped by category: Safety, Timer, Coaching, Context, Events.');
  bullet(ctx, 'Each rule has: On/Off toggle, severity (how urgently it speaks), cool-down (minimum seconds between re-fires), and any rule-specific thresholds (e.g. "on-scene stuck time" defaults to 8 minutes; you can raise to 10 for slow-moving welfare-check shifts).');

  h3(ctx, 'Common Tweaks');
  bullet(ctx, 'Night-shift dispatchers on slow beats often raise the on-scene stuck-time threshold from 8 minutes to 15 minutes to reduce spurious alerts on long welfare checks.');
  bullet(ctx, 'Metro-shift dispatchers on a busy Friday night often disable the "coaching" category entirely so the brain only speaks safety and timer rules — coaching adds chatter when the channel is already saturated.');
  bullet(ctx, 'Trainees leave everything on default for the first 90 days.');

  h3(ctx, 'Reset');
  bullet(ctx, 'At the bottom of the rule editor: "Reset to Defaults." Brings every rule back to factory settings. Useful when you have drifted your config over time and want a known baseline.');

  // ───────────────────────────────────────────────────────
  h2(ctx, '23.11 Dark Mode / High-Contrast — Accessibility Presets');
  paragraph(ctx,
    'The console defaults to the Spillman Flex pure-black theme (dark background, gold accents). For dispatchers with visual accessibility needs, two additional presets exist.',
  );
  bullet(ctx, 'High Contrast — increases text weight, thickens borders, and bumps accent saturation. User Profile -> Appearance -> High Contrast.');
  bullet(ctx, 'Light Theme — inverted color scheme with white background. NOT recommended for night-shift workstations (reduces dark adaptation) but useful for day-shift in bright rooms. User Profile -> Appearance -> Light Theme.');
  bullet(ctx, 'Text Size — three steps: Small (compact, default on 1440p+ displays), Medium, Large. Applies to every panel in the console uniformly.');

  // ───────────────────────────────────────────────────────
  h2(ctx, '23.12 Workstation Handoff — Leaving Your Post');
  paragraph(ctx,
    'When you step away from the console (bathroom break, end of shift, emergency), the workstation should know you are not there. This is separate from logging out — you can "hand off" temporary control to the next dispatcher without losing your session.',
  );
  bullet(ctx, 'Ctrl+Shift+H opens the Handoff dialog. Alternatively, click your name -> Handoff.');
  bullet(ctx, 'Choose handoff type: Short Break (<15 min, session stays open, you return to the same state), Shift Change (end of shift, session closes cleanly with a summary export), Emergency (abandon the workstation, the next dispatcher gets a fresh login but inherits your active call list).');
  bullet(ctx, 'On Short Break: the screen dims with a "DISPATCHER AWAY" banner, but the WebSocket stays connected and incoming events are queued. On your return, press any key and the dim lifts.');

  calloutBox(ctx, 'Handoff Discipline',
    'Never walk away from an active call without either handing it to another dispatcher explicitly or setting Short Break. An unhandled call with a unit on scene and no dispatcher awareness is how officer-safety incidents turn into officer-safety emergencies.',
    'warn',
  );
}

function appendixA(ctx: GuideContext): void {
  title(ctx, 'Appendix A — Incident Type Reference');

  paragraph(ctx,
    'The incident-type autocomplete in the intake form recognizes the types below. Typing the first few letters surfaces matching types; Tab accepts. The default priority is agency-configurable in Admin -> Incident Types.',
  );

  h2(ctx, 'Crimes Against Persons');
  table(ctx,
    ['Type', 'Default Priority'],
    [
      ['Homicide', 'P1'],
      ['Assault in progress', 'P1'],
      ['Assault — delayed report', 'P3'],
      ['Robbery in progress', 'P1'],
      ['Robbery — delayed report', 'P2'],
      ['Sexual assault in progress', 'P1'],
      ['Sexual assault — delayed report', 'P2'],
      ['Kidnapping', 'P1'],
      ['Domestic violence in progress', 'P1'],
      ['Domestic disturbance', 'P2'],
      ['Threats', 'P3'],
      ['Harassment', 'P3'],
    ],
    [6, 2],
  );

  h2(ctx, 'Crimes Against Property');
  table(ctx,
    ['Type', 'Default Priority'],
    [
      ['Burglary in progress', 'P1'],
      ['Burglary — delayed report', 'P3'],
      ['Theft in progress', 'P2'],
      ['Theft — delayed report', 'P3'],
      ['Vehicle theft in progress', 'P1'],
      ['Vehicle theft — delayed report', 'P3'],
      ['Vandalism', 'P3'],
      ['Trespass', 'P3'],
      ['Shoplifting in progress', 'P2'],
      ['Fraud', 'P4'],
      ['Arson', 'P1'],
    ],
    [6, 2],
  );

  h2(ctx, 'Traffic');
  table(ctx,
    ['Type', 'Default Priority'],
    [
      ['Traffic accident with injuries', 'P1'],
      ['Traffic accident — no injuries', 'P3'],
      ['Traffic accident — hit and run', 'P2'],
      ['Reckless driver', 'P2'],
      ['DUI in progress', 'P2'],
      ['Traffic stop', '-'],
      ['Road hazard', 'P3'],
    ],
    [6, 2],
  );

  h2(ctx, 'Public Safety / Service');
  table(ctx,
    ['Type', 'Default Priority'],
    [
      ['Suspicious person', 'P3'],
      ['Suspicious vehicle', 'P3'],
      ['Suspicious circumstances', 'P3'],
      ['Welfare check', 'P3'],
      ['Mental health crisis', 'P1'],
      ['Suicidal subject', 'P1'],
      ['Missing person — juvenile', 'P1'],
      ['Missing person — adult', 'P2'],
      ['Disturbance', 'P2'],
      ['Noise complaint', 'P3'],
      ['Civil standby', 'P4'],
      ['Lost / found property', 'P4'],
    ],
    [6, 2],
  );
}

function appendixB(ctx: GuideContext): void {
  title(ctx, 'Appendix B — Disposition Codes');

  paragraph(ctx,
    'When you clear a call (F7 or CL), the system prompts for a disposition code. The code is permanent — choose carefully. Most calls can be cleared with one of the codes below.',
  );

  table(ctx,
    ['Code', 'Disposition', 'When to Use'],
    [
      ['ARR',  'Arrest Made',          'Subject taken into custody on this call.'],
      ['RPT',  'Report Taken',         'Officer wrote or will write a formal incident report.'],
      ['GOA',  'Gone On Arrival',      'Subject left before officer arrived; no further action this call.'],
      ['UNF',  'Unfounded',            'Investigation determined no crime occurred.'],
      ['AST',  'Assistance Rendered',  'Aid provided, no report or arrest needed.'],
      ['REF',  'Referred to Agency',   'Matter handled by another agency (SLCPD, UHP, CPS, etc.).'],
      ['CAN',  'Cancelled by Caller',  'Caller cancelled before officer dispatched or arrived.'],
      ['CIV',  'Civil Matter',         'Not a criminal matter; parties directed to civil remedies.'],
      ['INF',  'Information Only',     'Call was informational; no action required.'],
      ['WAR',  'Warning Issued',       'Verbal or written warning given in lieu of citation.'],
      ['CIT',  'Citation Issued',      'Traffic or misdemeanor citation written.'],
      ['TRN',  'Transported',          'Subject transported (hospital, detox, shelter, jail).'],
      ['NOC',  'No Contact',           'Unable to contact subject; left note or will follow up.'],
      ['DUP',  'Duplicate Call',       'Already logged elsewhere; merged into primary record.'],
      ['REQ',  'Caller Requested Cancellation', 'Caller asked officer not to respond.'],
      ['OTH',  'Other (see notes)',    'Use sparingly; always include explanatory note.'],
    ],
    [2, 5, 7],
  );

  paragraph(ctx,
    'Do NOT use OTH as a catch-all. If you find yourself reaching for OTH more than once per shift, the disposition list may be missing a code your agency needs — talk to your supervisor about adding one.',
  );
}

function appendixC(ctx: GuideContext): void {
  title(ctx, 'Appendix C — Architecture for Dispatchers');

  paragraph(ctx,
    'A light-touch overview of how the system is put together, aimed at dispatchers who want to understand the plumbing enough to troubleshoot intelligently without becoming system administrators.',
  );

  h2(ctx, 'Where Things Live');
  bullet(ctx, 'Server — hosted at the VPS, accessible at https://rmpgutah.us. Node.js Express application running under systemd.');
  bullet(ctx, 'Database — SQLite file on the server. Every call, unit, incident, citation, person, and vehicle record lives here.');
  bullet(ctx, 'WebSocket — bidirectional connection between your browser and the server. Every dispatch event broadcasts to all connected workstations.');
  bullet(ctx, 'Your browser — renders the React client. Runs locally; no sensitive data persisted on your workstation beyond session tokens and UI preferences.');
  bullet(ctx, 'Edge TTS — server-side neural voice synthesis. Audio streams back to your browser which applies radio-bandpass filtering for the authentic dispatch sound.');
  bullet(ctx, 'Offline tiles — CartoDB dark_matter map tiles cached on your workstation by the service worker, so the map keeps working if internet flakes.');

  h2(ctx, 'What Persists Where');
  table(ctx,
    ['Data', 'Lives In'],
    [
      ['Calls, units, incidents, citations, people, vehicles', 'Server database (authoritative)'],
      ['Your session token', 'Browser localStorage (valid until session expiry)'],
      ['Voice persona, terseness, brain enabled', 'Server users table + browser localStorage (sync)'],
      ['Panel sizes, map center/zoom',              'Browser localStorage (per-workstation)'],
      ['Offline map tiles',                          'Browser service worker cache'],
      ['Spoken transcript (in-memory buffer)',       'Browser memory only; cleared on reload'],
      ['Audit log',                                  'Server database (authoritative; immutable)'],
    ],
    [5, 7],
  );

  h2(ctx, 'Why This Matters');
  paragraph(ctx,
    'Knowing what lives where helps you troubleshoot smarter. If your voice persona follows you across workstations, that is because it is stored server-side. If your map reset to Utah-wide view after a reload, that is because the zoom level is stored in your browser, not the server. If you see a call on one workstation but not another, that is a sync issue, not a call-creation issue.',
  );

  h2(ctx, 'Who to Contact for What');
  table(ctx,
    ['Problem', 'Who'],
    [
      ['Console bug, feature request, training question', 'Your supervisor first; IT if system-level'],
      ['Server down, database corruption, hard lockup',   'On-call admin via pager'],
      ['Password reset, account lockout',                 'Admin user; supervisor can escalate'],
      ['Data correction requiring audit override',        'Supervisor; supervisor escalates to admin'],
      ['Policy question about documentation',             'Agency supervisor (not IT)'],
      ['Legal request for records',                       'Chief / legal counsel, not dispatch'],
    ],
    [5, 5],
  );
}

// ═══════════════════════════════════════════════════════════
// Appendices D-F — educational reference material.
// D is the glossary (every term of art a new dispatcher will
// encounter), E is the phonetic alphabet + radio signals, F
// is the decision-flowchart appendix (radio phrase -> action).
// ═══════════════════════════════════════════════════════════

function appendixD(ctx: GuideContext): void {
  title(ctx, 'Appendix D — Glossary of Terms');

  paragraph(ctx,
    'A curated glossary of every term of art a new dispatcher will encounter in their first year. Terms are grouped by domain; within each group they are alphabetical. Items in ALL CAPS are acronyms; mixed-case items are commonly-spelled terms.',
  );

  h2(ctx, 'Dispatch & CAD');
  table(ctx,
    ['Term', 'Definition'],
    [
      ['ANI / ALI',      'Automatic Number Identification / Automatic Location Identification. Caller\'s phone number and registered service address, delivered by the 911 trunk before you pick up.'],
      ['BOLO',           'Be On the Look-Out. A broadcast describing a person, vehicle, or pattern to watch for. Active BOLOs persist across shifts until manually cleared or auto-expired.'],
      ['CAD',            'Computer-Aided Dispatch. The software system (this one) that manages calls, units, and radio traffic.'],
      ['Call Stack',     'The list of open calls-for-service. Called a "stack" because it is sorted top-down by priority.'],
      ['Dispatcher Brain','The rule engine that watches call and unit state for anomalies (stuck states, missing backup, overdue check-ins) and speaks reminders on the voice channel.'],
      ['GOA',            'Gone on Arrival. Disposition for a call where the reported activity or subject was no longer present when units arrived.'],
      ['MDT',            'Mobile Data Terminal. The in-vehicle computer an officer uses to see calls, run plates, and file reports.'],
      ['NCIC',           'National Crime Information Center. The FBI\'s national warrant / wanted-persons / stolen-property database.'],
      ['Premise Alert',  'A persistent warning tied to a specific address (e.g. "known aggressive dog", "wheelchair-bound resident"). Auto-displayed on any call to that address.'],
      ['Priority',       'P1 (life/safety) to P4 (administrative). See Section 4 for full definitions.'],
      ['PSO',            'Private Security Officer. RMPG contract-patrol designation for calls routed to contract patrol rather than sworn response.'],
      ['Ten-Code',       '10-series numeric radio brevity code (e.g. 10-4, 10-97). See Section 3.'],
      ['Signal Code',    'S-series agency-specific brevity code for incident types without a standard 10-code (e.g. S-3 shots fired).'],
    ],
    [2, 8],
  );

  h2(ctx, 'Records (RMS) & Reporting');
  table(ctx,
    ['Term', 'Definition'],
    [
      ['Case',           'An investigative unit that may span many calls, incidents, citations, arrests, warrants, and pieces of evidence.'],
      ['Citation',       'A ticket issued for a traffic or municipal-code violation. Each citation has one or more violation line items.'],
      ['Disposition',    'Final classification of a closed call or closed incident (e.g. CLEARED, REFERRED, UNFOUNDED, GOA).'],
      ['FI',             'Field Interview. Documented contact with a person not arrested, cited, or detained. See Section 16.'],
      ['Incident',       'A Spillman-style record documenting an event. An incident is created from a call once the call is closed with a reportable disposition.'],
      ['MNI',            'Master Name Index. The unified person table across calls, incidents, citations, arrests, warrants, and FIs.'],
      ['NIBRS',          'National Incident-Based Reporting System. FBI\'s successor to the summary UCR; each incident may have multiple NIBRS offense codes.'],
      ['Offense',        'A specific statute violation attached to an incident. One incident can have many offenses.'],
      ['RMS',             'Records Management System. The side of this application that keeps persisted records (as opposed to CAD, which is live state).'],
      ['Supplemental',   'An additional narrative filed against an already-closed incident (e.g. witness interviewed later, evidence located after the fact).'],
      ['UCR',            'Uniform Crime Reporting. Summary-level crime statistics (being phased out in favor of NIBRS).'],
      ['UoF',            'Use of Force. Any officer application of force that triggers a mandatory report regardless of outcome.'],
    ],
    [2, 8],
  );

  h2(ctx, 'Geography');
  table(ctx,
    ['Term', 'Definition'],
    [
      ['Area',    'Tier 1 of the dispatch geography hierarchy. Largest unit (e.g. "Wasatch Front").'],
      ['Sector',  'Tier 2. Subdivision of an area (e.g. "SLC Central").'],
      ['Zone',    'Tier 3. Subdivision of a sector, often aligned to patrol shifts.'],
      ['Beat',    'Tier 4. Smallest unit — typically a few square blocks. 719 beats cover the full Utah operational area.'],
      ['Geofence','A polygon triggering an automatic alert when a unit enters or leaves (used for perimeter operations, hot zones, and evidence areas).'],
    ],
    [2, 8],
  );

  h2(ctx, 'Radio & Voice');
  table(ctx,
    ['Term', 'Definition'],
    [
      ['Clear Channel', 'No radio traffic for at least 2 seconds. Good moment to transmit.'],
      ['Double-Key',    'Two units attempt to transmit at the same time; the result is a garbled squeal. Both back off and retry.'],
      ['Hot Mic',       'A stuck transmit button; a unit\'s microphone is broadcasting everything around it. The channel is unusable until fixed.'],
      ['Hold Traffic',  'Stop all non-emergency radio traffic (triggered by 10-33). The channel is reserved for the active emergency only.'],
      ['Simplex',       'Unit-to-unit radio without repeater. Short range, used for tactical. Dispatch does NOT hear simplex traffic.'],
      ['Squelch',       'The noise gate that opens when a signal is strong enough. Bad squelch = choppy audio. Heard as "you are broken / garbled" on the air.'],
    ],
    [2, 8],
  );

  h2(ctx, 'Legal & Safety');
  table(ctx,
    ['Term', 'Definition'],
    [
      ['Exigent Circumstances', 'A legal standard allowing warrantless entry when immediate action is required to prevent harm, escape, or evidence destruction.'],
      ['Probable Cause',        'Standard required for arrest or search warrant — facts sufficient to lead a reasonable person to believe a crime occurred.'],
      ['Reasonable Suspicion',  'Lower standard than probable cause, sufficient for a Terry stop or investigative detention.'],
      ['Terry Stop',            'Brief investigative detention based on reasonable suspicion (named for Terry v. Ohio, 392 U.S. 1, 1968).'],
      ['Two-Unit Rule',         'RMPG policy: any P1 call, any weapon involvement, any domestic violence, any known mental-health crisis, or any call at a business after hours requires a minimum of two units.'],
    ],
    [2, 8],
  );
}

function appendixE(ctx: GuideContext): void {
  title(ctx, 'Appendix E — Phonetic Alphabet & Radio Signals');

  paragraph(ctx,
    'The NATO / ICAO phonetic alphabet is the standard for spelling over the radio. It is used whenever any letter could be misheard — plate numbers, license plate configurations, names, spelled locations. RMPG dispatchers must use the NATO set; regional variants (Adam / Boy / Charles) are NOT accepted because they conflict with the FBI NCIC response format.',
  );

  h2(ctx, 'NATO Phonetic Alphabet');
  table(ctx,
    ['Letter', 'Phonetic', 'Pronunciation'],
    [
      ['A', 'Alfa',     'AL-fah'],
      ['B', 'Bravo',    'BRAH-voh'],
      ['C', 'Charlie',  'CHAR-lee'],
      ['D', 'Delta',    'DELL-tah'],
      ['E', 'Echo',     'EK-oh'],
      ['F', 'Foxtrot',  'FOKS-trot'],
      ['G', 'Golf',     'golf'],
      ['H', 'Hotel',    'hoh-TEL'],
      ['I', 'India',    'IN-dee-ah'],
      ['J', 'Juliett',  'JEW-lee-ett'],
      ['K', 'Kilo',     'KEY-loh'],
      ['L', 'Lima',     'LEE-mah'],
      ['M', 'Mike',     'mike'],
      ['N', 'November', 'no-VEM-ber'],
      ['O', 'Oscar',    'OSS-kah'],
      ['P', 'Papa',     'pah-PAH'],
      ['Q', 'Quebec',   'keh-BECK'],
      ['R', 'Romeo',    'ROW-me-oh'],
      ['S', 'Sierra',   'see-AIR-rah'],
      ['T', 'Tango',    'TANG-go'],
      ['U', 'Uniform',  'YOU-nee-form'],
      ['V', 'Victor',   'VIK-tah'],
      ['W', 'Whiskey',  'WISS-key'],
      ['X', 'X-ray',    'EKS-ray'],
      ['Y', 'Yankee',   'YANG-key'],
      ['Z', 'Zulu',     'ZOO-loo'],
    ],
    [2, 3, 5],
  );

  h2(ctx, 'Numbers — Spoken Form');
  paragraph(ctx,
    'Numbers are spoken digit-by-digit, NOT as grouped words. Plate "ABC 1234" is transmitted as "Alfa Bravo Charlie, one two three four" — NEVER "twelve thirty-four". The digit 9 is sometimes pronounced "NINE-er" to distinguish from "five" on a poor signal. Zero is "ZEE-row", never "oh".',
  );
  bullet(ctx, '0 — ZEE-row (never "oh")');
  bullet(ctx, '9 — NINE-er on poor signals');
  bullet(ctx, 'Decimals — "point" (e.g. "four point five")');
  bullet(ctx, 'Thousands — individual digits, NOT "one thousand two hundred"');

  h2(ctx, 'Transmission Standards');
  bullet(ctx, 'Call the unit FIRST, then identify yourself. "U07 Dispatch" — U07 hears their call sign and listens for the message that follows.');
  bullet(ctx, 'Pause briefly after keying before speaking; repeaters take about 200ms to come up.');
  bullet(ctx, 'Release the key at end of transmission; do not trail off with "... uh ... over".');
  bullet(ctx, '"Over" means "your turn to transmit". "Out" means "transmission complete, no reply expected". Do NOT say "over and out" — it is contradictory and immediately identifies a non-professional.');
  bullet(ctx, 'Transmissions under 5 seconds. Longer than that, break into two transmissions with an acknowledgment between.');

  h2(ctx, 'Common Q-Signals (Supplementary)');
  paragraph(ctx,
    'Q-signals are amateur-radio style brevity codes. RMPG uses very few, but these three are occasionally heard from adjacent agencies or on simplex:',
  );
  table(ctx,
    ['Code', 'Meaning'],
    [
      ['QRM', 'Interference on the channel'],
      ['QSL', 'Acknowledged / received'],
      ['QTH', 'What is your location? (interchangeable with 10-20)'],
    ],
    [2, 8],
  );

  calloutBox(ctx, 'Clarity Over Brevity',
    'If a transmission is unclear, say "say again all after [last clear word]" — NOT just "repeat" (which in artillery convention means "fire again"). "Say again" is unambiguous and works on any channel.',
    'info',
  );
}

function appendixF(ctx: GuideContext): void {
  title(ctx, 'Appendix F — Decision Flowcharts');

  paragraph(ctx,
    'These flowcharts are meant to be scanned, not read linearly. Each one starts with a trigger — something you hear on the radio or see on the screen — and walks through the first one or two decisions. The goal is to compress the "what do I do first?" moment to under 5 seconds.',
  );

  h2(ctx, 'Flow 1 — Officer Says "10-99" (Officer Emergency)');
  bullet(ctx, 'STEP 1: Immediately press F12 (panic broadcast). Every workstation and MDT hears the emergency tone.');
  bullet(ctx, 'STEP 2: Hold all non-emergency radio traffic. Say "All units, stand by for emergency traffic" on the voice channel.');
  bullet(ctx, 'STEP 3: Confirm unit location. If GPS is current, use it. If not, ask "U__ Dispatch, give me your 20."');
  bullet(ctx, 'STEP 4: Dispatch nearest units (F3). Minimum three-unit response for 10-99.');
  bullet(ctx, 'STEP 5: Page on-call supervisor. If supervisor already on-duty, that supervisor takes command.');
  bullet(ctx, 'STEP 6: Notify SLCPD dispatch if within SLC city limits; notify Unified PD Central Dispatch if not.');
  bullet(ctx, 'STEP 7: Do NOT clear the 10-99 status until the officer personally confirms 10-4 on the air.');

  h2(ctx, 'Flow 2 — Officer Does Not Respond to Two Radio Checks');
  bullet(ctx, 'STEP 1: Wait 10 seconds between your first and second radio check. Do not stack them.');
  bullet(ctx, 'STEP 2: After second no-response, call by partner if any. ("U08, do you have eyes on U07?")');
  bullet(ctx, 'STEP 3: Check the unit\'s last GPS point. If within last 60 seconds AND reasonable for their assignment, escalate cautiously.');
  bullet(ctx, 'STEP 4: If GPS is stale (>90s) OR the unit was on a risky call (traffic stop, premise check, domestic), treat as 10-99 and run Flow 1.');
  bullet(ctx, 'STEP 5: Assume the officer is fine until you have reason to believe otherwise, but act on the reasonable worst-case.');

  h2(ctx, 'Flow 3 — BOLO Hit by an Officer');
  bullet(ctx, 'STEP 1: Officer radios "I\'m on the BOLO vehicle at [location]." You immediately acknowledge: "10-4, U__, on the BOLO at [repeat location]."');
  bullet(ctx, 'STEP 2: Check the BOLO record for officer-safety flags. Voice-channel those flags immediately: "BOLO flags: WEAPON, GANG, FELONY WARRANT."');
  bullet(ctx, 'STEP 3: Dispatch minimum two-unit backup if not already en route. Three units for weapon flag.');
  bullet(ctx, 'STEP 4: Stay on top of radio traffic — officers on a BOLO stop will be quiet for 15-30 seconds while they approach. Silence does not mean problem.');
  bullet(ctx, 'STEP 5: If the stop generates arrests, felony charges, or a pursuit, escalate to supervisor. Clear the BOLO only when the officer confirms the subject(s) are in custody or cleared.');

  h2(ctx, 'Flow 4 — 911 Hang-Up With ANI/ALI But No Voice');
  bullet(ctx, 'STEP 1: Call back the ANI number from a recorded line. Up to two attempts.');
  bullet(ctx, 'STEP 2: If no answer or immediate hang-up on callback, create a call: type "911 HANGUP - CHECK WELFARE" at the ALI address.');
  bullet(ctx, 'STEP 3: Priority 2. Minimum one-unit response, two-unit if the address has a premise alert or prior DV history.');
  bullet(ctx, 'STEP 4: DO NOT assume pocket-dial. Treat every 911 hang-up as a potential DV or medical emergency until units can verify otherwise.');

  h2(ctx, 'Flow 5 — Traffic Stop Escalates');
  bullet(ctx, 'STEP 1: Officer radios something unusual ("stand by," "I need backup," change in tone). Acknowledge calmly: "10-4 U__, you need assistance?"');
  bullet(ctx, 'STEP 2: If confirmed, dispatch nearest available unit — do not wait for the officer to specify.');
  bullet(ctx, 'STEP 3: Hold the channel for that officer. Stop any non-emergency traffic: "All units, hold traffic for U__."');
  bullet(ctx, 'STEP 4: Run the plate and occupants again in the background while the stop is developing. New warrant hits or felony flags change the whole call.');
  bullet(ctx, 'STEP 5: If the stop becomes a felony / weapon stop, escalate to Flow 3 (BOLO Hit) logic for additional units and supervisor notification.');

  h2(ctx, 'Flow 6 — Mental-Health Crisis Call');
  bullet(ctx, 'STEP 1: Get the subject\'s immediate state. Armed? Actively self-harming? Compliant? Stable and talking?');
  bullet(ctx, 'STEP 2: If armed or actively self-harming, dispatch as P1 with WEAPON (if applicable) + MENTAL_HEALTH flags, two-unit minimum, and request CIT-certified officer via /cit-request.');
  bullet(ctx, 'STEP 3: If stable and talking, dispatch as P2 with MENTAL_HEALTH flag. CIT-preferred, one-unit OK if low risk and known to the system.');
  bullet(ctx, 'STEP 4: Check the person record for prior MH history — if this is a repeat contact, voice-channel that fact to responding units so they have context.');
  bullet(ctx, 'STEP 5: Do NOT dispatch mental-health calls as "welfare check" unless you truly have no information. "Welfare check" hides the clinical flag and responding units do not know what they are walking into.');

  calloutBox(ctx, 'Meta-Rule',
    'Every flow above has a final unwritten step: document. Every decision, every escalation, every consultation with a supervisor goes in the call notes with a timestamp. If it is not in the notes, it did not happen — regardless of how correct the decision was.',
    'warn',
  );
}

function quickReferenceCard(ctx: GuideContext): void {
  // This is the final page — a dense cheat sheet designed to be torn off.
  newPage(ctx);
  const d = ctx.doc;

  d.setFillColor(COLOR.ACCENT);
  d.rect(0, 50, PAGE.W, 6, 'F');

  d.setFont('helvetica', 'bold');
  d.setFontSize(16);
  d.setTextColor(COLOR.BLACK);
  d.text('QUICK-REFERENCE CARD', PAGE.W / 2, 80, { align: 'center' });
  d.setFont('helvetica', 'normal');
  d.setFontSize(9);
  d.setTextColor(COLOR.MUTED);
  d.text('Dispatch Console — Rocky Mountain Protective Group', PAGE.W / 2, 96, { align: 'center' });

  ctx.y = 110;

  // Compact 3-column layout: F-keys, 10-codes, common CAD verbs
  const colW = (PAGE.W - PAGE.MARGIN * 2 - 16) / 3;
  const colX = [PAGE.MARGIN, PAGE.MARGIN + colW + 8, PAGE.MARGIN + colW * 2 + 16];
  const topY = ctx.y;

  const writeList = (x: number, heading: string, rows: Array<[string, string]>): number => {
    d.setFont('helvetica', 'bold');
    d.setFontSize(10);
    d.setTextColor(COLOR.ACCENT);
    d.text(heading, x, topY);
    d.setDrawColor(COLOR.ACCENT);
    d.setLineWidth(1);
    d.line(x, topY + 3, x + 48, topY + 3);

    let yy = topY + 20;
    d.setFontSize(9);
    d.setTextColor(COLOR.INK);
    for (const [k, v] of rows) {
      d.setFont('helvetica', 'bold');
      d.text(k, x, yy);
      d.setFont('helvetica', 'normal');
      // Wrap the description if needed
      const lines = d.splitTextToSize(v, colW - 52) as string[];
      for (let i = 0; i < lines.length; i++) {
        d.text(lines[i], x + 44, yy + i * 11);
      }
      yy += Math.max(14, lines.length * 11 + 3);
    }
    return yy;
  };

  const fKeyBottom = writeList(colX[0], 'F-KEYS', [
    ['F2', 'New call'],
    ['F3', 'Dispatch unit'],
    ['F5', 'En route'],
    ['F6', 'On scene'],
    ['F7', 'Clear'],
    ['F8', 'CAD command line'],
    ['F12', 'NCIC query'],
    ['V', 'Open voice channel'],
    ['T', 'Toggle transcript'],
    ['?', 'Shortcut help'],
  ]);

  const tenCodeBottom = writeList(colX[1], '10-CODES', [
    ['10-4', 'Acknowledge'],
    ['10-6', 'Busy'],
    ['10-7', 'Out of service'],
    ['10-8', 'Available'],
    ['10-10', 'On break'],
    ['10-20', 'Location?'],
    ['10-23', 'Stand by'],
    ['10-50', 'Traffic collision'],
    ['10-76', 'En route'],
    ['10-97', 'On scene'],
    ['10-99', 'Officer emergency'],
  ]);

  const cadBottom = writeList(colX[2], 'CAD VERBS', [
    ['NC',  'New call'],
    ['CI',  'Select call'],
    ['AS',  'Assign unit'],
    ['ST',  'Unit status'],
    ['CL',  'Clear call'],
    ['NT',  'Append note'],
    ['PRI', 'Set priority'],
    ['BO',  'Broadcast BOLO'],
    ['QP',  'Query person'],
    ['QV',  'Query vehicle'],
    ['QW',  'Query warrant'],
    ['QT',  'Query plate'],
    ['PR',  'Premise alerts'],
    ['LE',  '10-code lookup'],
  ]);

  // Priority + safety flags stripe across bottom
  let bottomY = Math.max(fKeyBottom, tenCodeBottom, cadBottom) + 20;
  ctx.y = bottomY;

  // Priority stripe
  d.setFont('helvetica', 'bold');
  d.setFontSize(10);
  d.setTextColor(COLOR.ACCENT);
  d.text('PRIORITY', PAGE.MARGIN, bottomY);
  d.setDrawColor(COLOR.ACCENT);
  d.line(PAGE.MARGIN, bottomY + 3, PAGE.MARGIN + 56, bottomY + 3);

  const pWidth = (PAGE.W - PAGE.MARGIN * 2) / 4;
  const priorities: Array<[string, string, [number, number, number]]> = [
    ['P1', 'Life/safety — lights + siren',   [185, 28, 28]],
    ['P2', 'In-progress — respond promptly', [217, 119, 6]],
    ['P3', 'Routine',                        [202, 138, 4]],
    ['P4', 'Cold / report only',             [107, 114, 128]],
  ];
  bottomY += 16;
  for (let i = 0; i < priorities.length; i++) {
    const [code, desc, rgb] = priorities[i];
    const px = PAGE.MARGIN + pWidth * i;
    d.setFillColor(rgb[0], rgb[1], rgb[2]);
    d.rect(px, bottomY, pWidth - 8, 40, 'F');
    d.setTextColor(255, 255, 255);
    d.setFont('helvetica', 'bold');
    d.setFontSize(14);
    d.text(code, px + 8, bottomY + 18);
    d.setFont('helvetica', 'normal');
    d.setFontSize(8);
    const wrapped = d.splitTextToSize(desc, pWidth - 20) as string[];
    for (let j = 0; j < wrapped.length; j++) {
      d.text(wrapped[j], px + 8, bottomY + 30 + j * 9);
    }
  }
  bottomY += 56;

  // Safety flags row
  d.setFont('helvetica', 'bold');
  d.setFontSize(10);
  d.setTextColor(COLOR.ACCENT);
  d.text('SAFETY FLAGS', PAGE.MARGIN, bottomY);
  d.line(PAGE.MARGIN, bottomY + 3, PAGE.MARGIN + 80, bottomY + 3);
  bottomY += 16;
  d.setFont('helvetica', 'normal');
  d.setFontSize(9);
  d.setTextColor(COLOR.INK);
  const flags = 'Weapons  •  Domestic Violence  •  Felony in Progress  •  Mental Health  •  Officer Safety Caution  •  Pursuit  •  Hazmat  •  Juvenile Involved';
  d.text(flags, PAGE.MARGIN, bottomY);
  bottomY += 20;

  // Voice summary
  d.setFont('helvetica', 'bold');
  d.setTextColor(COLOR.ACCENT);
  d.setFontSize(10);
  d.text('VOICE (WHEN ENABLED)', PAGE.MARGIN, bottomY);
  d.line(PAGE.MARGIN, bottomY + 3, PAGE.MARGIN + 124, bottomY + 3);
  bottomY += 16;
  d.setFont('helvetica', 'normal');
  d.setFontSize(9);
  d.setTextColor(COLOR.INK);
  // Use splitTextToSize so lines wrap inside the page margins. Hardcoded
  // d.text() calls overflow the right edge and clip to "standa..." at
  // fontSize 9 because 100+ char lines exceed the 504pt content width.
  const voiceLines = [
    'User Profile -> Voice tab. Toggle Dispatcher Brain (Beta). Terseness: narrative / standard / terse.',
    'Brain speaks: events (citations, incidents, warrants, evidence, arrests, HR) + coaching (DV, felony, MH, overdue status, geofence breach).',
    'Press V for mic. "Tell me about that call." Press T for transcript.',
  ];
  const voiceContentW = PAGE.W - PAGE.MARGIN * 2;
  let voiceOffsetY = 0;
  for (const rawLine of voiceLines) {
    const wrapped = d.splitTextToSize(rawLine, voiceContentW) as string[];
    for (const w of wrapped) {
      d.text(w, PAGE.MARGIN, bottomY + voiceOffsetY);
      voiceOffsetY += 11;
    }
  }

  // Emergency box at very bottom
  bottomY = PAGE.H - 120;
  d.setFillColor(255, 244, 242);
  d.setDrawColor(COLOR.RED);
  d.setLineWidth(1.5);
  d.rect(PAGE.MARGIN, bottomY, PAGE.W - PAGE.MARGIN * 2, 50, 'FD');
  d.setFont('helvetica', 'bold');
  d.setFontSize(11);
  d.setTextColor(COLOR.RED);
  d.text('EMERGENCY — 10-99 / OFFICER DOWN', PAGE.MARGIN + 12, bottomY + 18);
  d.setFont('helvetica', 'normal');
  d.setFontSize(9);
  d.setTextColor(COLOR.INK);
  d.text('Broadcast immediately. Dispatch all available units to last known position. Notify supervisor', PAGE.MARGIN + 12, bottomY + 32);
  d.text('and SLCPD if within city limits. Do NOT clear until officer confirms 10-4.', PAGE.MARGIN + 12, bottomY + 44);
}

// ─── Live-data fetch ────────────────────────────────────────

/**
 * Attempt to fetch the current 10-code and signal-code list from the
 * server. Returns null on any failure so callers fall back to the
 * hardcoded tables — dispatchers on a flaky connection still need the guide.
 */
async function fetchLiveCodes(): Promise<LiveDispatchCode[] | null> {
  try {
    const res = await fetch('/api/dispatch/geography/codes', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data as LiveDispatchCode[];
  } catch {
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────

/** Registry of emitters in the order they appear in the final PDF. */
interface SectionSpec {
  label: string;
  emit: (ctx: GuideContext) => void;
}

function buildSectionSpecs(): SectionSpec[] {
  return [
    { label: '1. Console Overview',                        emit: section1 },
    { label: '2. Taking a Call End-to-End',                emit: section2 },
    { label: '3. Unit Status & 10-Codes',                  emit: section3 },
    { label: '4. Safety Flags & Priority Levels',          emit: section4 },
    { label: '5. F-Key Hotkeys',                           emit: section5 },
    { label: '6. CAD Command Line',                        emit: section6 },
    { label: '7. Voice Features (Dispatcher Brain)',       emit: section7 },
    { label: '8. Common Workflows',                        emit: section8 },
    { label: '9. Troubleshooting',                         emit: section9 },
    { label: '10. Radio Etiquette & Voice Protocols',      emit: section10 },
    { label: '11. Documentation Standards',                emit: section11 },
    { label: '12. Using the Map',                          emit: section12 },
    { label: '13. Shift Change Procedure',                 emit: section13 },
    { label: '14. Real-Time Sync & Offline Behavior',      emit: section14 },
    { label: '15. Map V2 (OpenLayers, Beta)',              emit: section15 },
    { label: '16. Field Interviews',                       emit: section16 },
    { label: '17. Process Service / Serve Queue',          emit: section17 },
    { label: '18. Skip Tracer V2',                         emit: section18 },
    { label: '19. Compound & Universal Search',            emit: section19 },
    { label: '20. Anatomy of the Console',                 emit: section20 },
    { label: '21. Worked Example — Shots-Fired Call',      emit: section21 },
    { label: '22. Your First Shift — Onboarding',          emit: section22 },
    { label: '23. How To Use — AI & Subsystems',           emit: section23 },
    { label: 'Appendix A — Incident Type Reference',       emit: appendixA },
    { label: 'Appendix B — Disposition Codes',             emit: appendixB },
    { label: 'Appendix C — Architecture for Dispatchers',  emit: appendixC },
    { label: 'Appendix D — Glossary of Terms',             emit: appendixD },
    { label: 'Appendix E — Phonetic Alphabet & Radio',     emit: appendixE },
    { label: 'Appendix F — Decision Flowcharts',           emit: appendixF },
    { label: 'Quick-Reference Card',                       emit: quickReferenceCard },
  ];
}

/**
 * Build the Dispatch Guide PDF and trigger a browser download.
 *
 * Flow: (1) fetch live 10-codes (best-effort), (2) emit every section on a
 * temporary scratch document to collect page-start anchors, (3) prepend the
 * cover page with a clickable TOC pointing at those anchors, (4) re-render
 * footers now that the page total is known, (5) save.
 *
 * We emit sections first and the cover page last so the TOC can hold real
 * page numbers. jsPDF doesn't support "named destinations" that survive
 * page reordering, so we build the cover at the end and use `movePage` to
 * slide it to position 1.
 *
 * Filename includes today's date so dispatchers can see at a glance which
 * version they have on the console.
 */
export async function generateDispatchGuidePdf(): Promise<void> {
  const liveCodes = await fetchLiveCodes();

  const doc = new jsPDF({ format: 'letter', unit: 'pt' });
  const ctx: GuideContext = {
    doc,
    y: PAGE.MARGIN,
    page: 1,
    liveCodes,
    anchors: [],
  };

  const specs = buildSectionSpecs();

  // The first page is auto-created by jsPDF and doesn't pass through newPage(),
  // so the running header is never drawn on it. Draw it manually for parity
  // with every subsequent page.
  pageHeader(ctx);

  // Pass 1 — emit every section, recording each one's start page in ctx.anchors.
  // Section 1 lands on the auto-created page 1 so we don't waste a blank page
  // before reordering.
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    if (i > 0) newPage(ctx);
    anchor(ctx, spec.label);
    spec.emit(ctx);
  }

  // Pass 2 — add the cover page at the END, then relocate to position 1.
  // Anchors were captured in pass 1 and still reference pages 1..N; after
  // we insert the cover at the front each anchor's page increments by 1.
  doc.addPage();
  const coverPageNum = doc.getNumberOfPages();
  doc.setPage(coverPageNum);

  // Shift every recorded page by +1 to account for the cover going in front.
  for (const a of ctx.anchors) a.page += 1;

  coverPage(ctx);
  doc.movePage(coverPageNum, 1);

  // Pass 3 — render footers (page N of M) on every page except the cover.
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    if (p === 1) continue; // cover page has no footer
    pageFooter({ ...ctx, y: 0, page: p }, total);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`RMPG-Dispatch-Guide-${stamp}.pdf`);
}
