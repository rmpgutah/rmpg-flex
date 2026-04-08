// ============================================================
// RMPG Flex — NIBRS/UCR Grid-Based Form Helpers
// Dense grid cells with inline labels, sidebar section tabs,
// compact checkbox grids, and embedded code reference tables
// Designed to replicate official law enforcement form formats
// ============================================================

import jsPDF from 'jspdf';
import { sanitizePdfText, wordWrapText } from './pdfGenerator';
import {
  COLOR, FONT, BORDER, SPACING, LAYOUT,
  getGridStartX, getGridContentWidth,
  type RGBColor,
} from './pdfTokens';

// ── Interfaces ──────────────────────────────────────────────

/** Single cell in a grid row */
export interface FormCell {
  /** Tiny label text (top-left inside cell) e.g. "1. AGENCY NAME" */
  label: string;
  /** Value text displayed below label in Courier */
  value: string;
  /** Proportional width ratio (default 1) */
  ratio?: number;
  /** If true, render as checkbox instead of text value */
  checkbox?: boolean;
  /** Checkbox state (only used when checkbox=true) */
  checked?: boolean;
  /** Text alignment for value: 'left' | 'center' | 'right' */
  align?: 'left' | 'center' | 'right';
  /** If true, use bold Courier for value */
  valueBold?: boolean;
  /** Override font size for value */
  valueFontSize?: number;
}

/** Row of cells in a form grid */
export interface FormRow {
  /** Cells in this row */
  cells: FormCell[];
  /** Override row height (default SPACING.FORM_CELL_H) */
  height?: number;
}

/** Sidebar section tab configuration */
export interface SideTabConfig {
  /** Tab label text (rendered vertically, all-caps) */
  label: string;
  /** Background color (default COLOR.BG_SIDEBAR_TAB) */
  color?: RGBColor;
  /** Text color (default COLOR.TEXT_INVERTED) */
  textColor?: RGBColor;
}

/** Single checkbox item in a compact checkbox grid */
export interface CheckboxItem {
  /** Optional NIBRS code prefix (e.g. "01") */
  code?: string;
  /** Label text next to checkbox */
  label: string;
  /** Whether checked */
  checked: boolean;
}

/** Code reference table entry */
export interface CodeEntry {
  /** Code identifier (e.g. "20") */
  code: string;
  /** Description text */
  description: string;
}

// ── Drawing Primitives ──────────────────────────────────────

/**
 * Draw a single form cell: bordered rectangle with tiny label
 * at top-left inside the cell, value text below.
 */
/** Line height multiplier for form cell value text (mm per line) */
const CELL_LINE_H = 3;

/**
 * Measure how many wrapped lines a cell's value text needs at the given width.
 * Returns the line count (minimum 1). Useful for pre-computing row heights.
 */
export function measureCellLines(doc: jsPDF, cell: FormCell, cellW: number): number {
  if (cell.checkbox || !cell.value) return 1;
  const pad = SPACING.FORM_CELL_PAD;
  const maxW = cellW - 2 * pad;
  if (maxW <= 0) return 1;
  const sanitized = sanitizePdfText(cell.value);
  if (!sanitized) return 1;
  doc.setFont('courier', cell.valueBold ? 'bold' : 'normal');
  doc.setFontSize(cell.valueFontSize || FONT.SIZE_FORM_CELL_VALUE);
  const lines = wordWrapText(doc, sanitized.toUpperCase(), maxW - 1);
  return Math.max(1, lines.length);
}

/**
 * Compute the minimum row height needed for a set of cells at given total width.
 * Accounts for label strip + wrapped value lines.
 */
export function computeRowHeight(doc: jsPDF, cells: FormCell[], totalW: number): number {
  if (!cells || cells.length === 0) return SPACING.FORM_CELL_H;
  const totalRatio = cells.reduce((sum, c) => sum + (c.ratio || 1), 0) || 1;
  let maxLines = 1;
  for (const cell of cells) {
    const ratio = cell.ratio || 1;
    const cellW = (ratio / totalRatio) * totalW;
    const lines = measureCellLines(doc, cell, cellW);
    if (lines > maxLines) maxLines = lines;
  }
  const labelStripH = SPACING.FORM_CELL_LABEL_H + 0.3;
  const pad = SPACING.FORM_CELL_PAD;
  const neededH = labelStripH + pad + maxLines * CELL_LINE_H + pad;
  return Math.max(SPACING.FORM_CELL_H, neededH);
}

export function drawFormCell(
  doc: jsPDF,
  cell: FormCell,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const pad = SPACING.FORM_CELL_PAD;

  // Sanitize cell value to convert Unicode chars to ASCII-safe equivalents
  if (cell.value) cell = { ...cell, value: sanitizePdfText(cell.value) };

  // No cell border — clean borderless style matching CFS report

  // Label (Helvetica Bold, dark gray — above value)
  const labelBaseY = y + pad + 1.2;
  if (cell.label) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5); // 5.5pt labels matching CFS addFieldPair style
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    // Strip numbered prefix patterns like "1. ", "12. " from labels
    const cleanLabel = cell.label.replace(/^\d+\.\s*/, '').toUpperCase();
    doc.text(cleanLabel, x + pad, labelBaseY);
  }

  // Value area starts below label strip
  const labelStripH = SPACING.FORM_CELL_LABEL_H + 0.3;
  const valueAreaTop = y + labelStripH + pad;
  const valueAreaH = h - labelStripH - pad;

  // Value (Courier, black — word-wrapped within cell bounds)
  if (cell.checkbox) {
    // Render checkbox square centered vertically in value area
    const cbSize = 2.8;
    const cbX = x + pad;
    const cbY = valueAreaTop + (valueAreaH - cbSize) / 2;
    doc.setDrawColor(...COLOR.BORDER_FORM_GRID);
    doc.setLineWidth(BORDER.CHECKBOX);
    doc.rect(cbX, cbY, cbSize, cbSize);
    if (cell.checked) {
      doc.setLineWidth(BORDER.CHECK_MARK);
      doc.line(cbX + 0.5, cbY + 1.4, cbX + 1.1, cbY + 2.3);
      doc.line(cbX + 1.1, cbY + 2.3, cbX + 2.3, cbY + 0.5);
    }
    // Label text after checkbox — Courier
    if (cell.value) {
      doc.setFont('courier', 'normal');
      doc.setFontSize(cell.valueFontSize || FONT.SIZE_FORM_CELL_VALUE);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text(cell.value, cbX + cbSize + 1, cbY + cbSize - 0.3);
    }
  } else if (cell.value) {
    doc.setFont('courier', cell.valueBold ? 'bold' : 'normal');
    const fontSize = cell.valueFontSize || FONT.SIZE_FORM_CELL_VALUE;
    doc.setFontSize(fontSize);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);

    const maxW = w - 2 * pad;
    const displayVal = cell.value.toUpperCase();

    // Word-wrap manually to stay within cell bounds (no jsPDF maxWidth overflow)
    const lines = wordWrapText(doc, displayVal, maxW - 1);
    const lineH = CELL_LINE_H;
    const textBlockH = lines.length * lineH;
    // Vertically center the text block in the value area
    const startY = valueAreaTop + Math.max(0, (valueAreaH - textBlockH) / 2) + lineH * 0.72;

    for (let li = 0; li < lines.length; li++) {
      const lineY = startY + li * lineH;
      // Stop rendering if line would exceed cell bottom
      if (lineY > y + h + 0.5) break;
      const line = lines[li];
      if (cell.align === 'center') {
        doc.text(line, x + w / 2, lineY, { align: 'center' });
      } else if (cell.align === 'right') {
        doc.text(line, x + w - pad, lineY, { align: 'right' });
      } else {
        doc.text(line, x + pad, lineY);
      }
    }
  }
}

/**
 * Draw a row of adjacent form cells, distributing width by ratio.
 * Row height auto-expands to fit the tallest cell's wrapped text.
 * An explicit rowH overrides auto-sizing (minimum enforced).
 * Returns the Y position after the row.
 */
export function drawFormRow(
  doc: jsPDF,
  cells: FormCell[],
  x: number,
  y: number,
  totalW: number,
  rowH?: number,
): number {
  if (!cells || cells.length === 0) return y + (rowH || SPACING.FORM_CELL_H);
  // Auto-compute row height from cell content; explicit rowH sets a minimum
  const autoH = computeRowHeight(doc, cells, totalW);
  const h = rowH ? Math.max(rowH, autoH) : autoH;
  const totalRatio = cells.reduce((sum, c) => sum + (c.ratio || 1), 0) || 1;

  // Draw outer row border (single shared edge — no doubles)
  doc.setDrawColor(...COLOR.BORDER_FIELD);
  doc.setLineWidth(BORDER.FORM_CELL);
  doc.rect(x, y, totalW, h);

  // Draw cell content + vertical dividers between cells
  let cellX = x;
  for (let i = 0; i < cells.length; i++) {
    const ratio = cells[i].ratio || 1;
    const cellW = (ratio / totalRatio) * totalW;
    drawFormCell(doc, cells[i], cellX, y, cellW, h);
    // Vertical divider (skip last cell — right edge is the row border)
    if (i < cells.length - 1) {
      doc.setDrawColor(...COLOR.BORDER_FIELD);
      doc.setLineWidth(BORDER.FORM_CELL);
      doc.line(cellX + cellW, y, cellX + cellW, y + h);
    }
    cellX += cellW;
  }

  return y + h;
}

/**
 * Draw a multi-row form grid. Each row is an array of cells.
 * Optional bold outer border. Returns Y after the last row.
 */
export function drawFormGrid(
  doc: jsPDF,
  rows: FormRow[],
  x: number,
  y: number,
  totalW: number,
  opts?: { outerBorder?: boolean },
): number {
  let curY = y;

  for (const row of rows) {
    // Pass explicit row.height as minimum; drawFormRow auto-expands if text needs more
    curY = drawFormRow(doc, row.cells, x, curY, totalW, row.height);
  }

  return curY;
}

/**
 * Draw a vertical sidebar section tab (dark background, rotated white text).
 * The tab spans from y to y+height on the left side of the page.
 */
export function drawSideTab(
  doc: jsPDF,
  label: string,
  y: number,
  height: number,
  color?: RGBColor,
): void {
  const tabW = LAYOUT.SIDEBAR_TAB_W;
  const tabX = LAYOUT.PAGE_MARGIN;
  const bgColor = color || COLOR.BG_SIDEBAR_TAB;

  // Dark background rectangle
  doc.setFillColor(...bgColor);
  doc.setDrawColor(...COLOR.BORDER_FORM_GRID);
  doc.setLineWidth(BORDER.SIDEBAR_TAB);
  doc.rect(tabX, y, tabW, height, 'FD');

  // Rotated white text — manually centered vertically in tab.
  // jsPDF's align:'center' acts on the pre-rotation axis, so with
  // angle:90 it would center across the tab WIDTH (wrong axis).
  // Instead we measure text width and offset the anchor Y ourselves.
  const upperLabel = sanitizePdfText(label.toUpperCase());
  const maxTextLen = height - 4;
  let fontSize: number = FONT.SIZE_SIDEBAR_TAB;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  let textW = doc.getTextWidth(upperLabel);

  // Scale down if text overflows available height
  if (textW > maxTextLen && maxTextLen > 0 && textW > 0) {
    fontSize = fontSize * (maxTextLen / textW);
    fontSize = Math.max(fontSize, 3); // floor at 3pt to prevent invisible text
    doc.setFontSize(fontSize);
    textW = doc.getTextWidth(upperLabel);
  }

  doc.setTextColor(...COLOR.TEXT_INVERTED);

  // With angle:90 (CCW), text starts at anchor and extends UPWARD.
  // To center: place anchor at (y + height/2 + textW/2) so the
  // middle of the text lands at the vertical center of the tab.
  const textX = tabX + tabW / 2 + 1;
  const textY = y + height / 2 + textW / 2;

  doc.text(upperLabel, textX, textY, { angle: 90 });
}

/**
 * Draw a compact multi-column checkbox grid.
 * Returns Y after the grid.
 */
export function drawCheckboxGrid(
  doc: jsPDF,
  items: CheckboxItem[],
  x: number,
  y: number,
  cols: number,
  totalW: number,
  opts?: { rowHeight?: number },
): number {
  const cellW = totalW / cols;
  const rowH = opts?.rowHeight || 4.5;
  const cbSize = 2.2; // Intentional: 2.2mm is the optimal checkbox size for form readability
  let curY = y;

  for (let i = 0; i < items.length; i++) {
    const col = i % cols;
    const cellX = x + col * cellW;

    if (col === 0 && i > 0) curY += rowH;

    // Checkbox square
    const cbX = cellX + 0.8;
    const cbY = curY + 0.6;
    doc.setDrawColor(...COLOR.BORDER_FORM_GRID);
    doc.setLineWidth(BORDER.CHECKBOX);
    doc.rect(cbX, cbY, cbSize, cbSize);

    if (items[i].checked) {
      doc.setLineWidth(BORDER.CHECK_MARK);
      doc.line(cbX + 0.3, cbY + 1.1, cbX + 0.85, cbY + 1.8);
      doc.line(cbX + 0.85, cbY + 1.8, cbX + 1.9, cbY + 0.4);
    }

    // Label text — sanitize to prevent Unicode crashes
    const rawLabel = items[i].code
      ? `${items[i].code} = ${items[i].label}`
      : items[i].label;
    const labelText = sanitizePdfText(rawLabel);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_FORM_CELL_LABEL);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(labelText, cbX + cbSize + 0.8, cbY + cbSize - 0.2, {
      maxWidth: cellW - cbSize - 2.5,
    });
  }

  // Account for last row
  curY += rowH;

  // No outer border — clean borderless style matching CFS report

  return curY;
}

/**
 * Draw an embedded code reference table (NIBRS property codes, weapon types, etc.).
 * Compact multi-column layout: "CODE = DESCRIPTION" per entry.
 * Returns Y after the table.
 */
export function drawCodeReferenceTable(
  doc: jsPDF,
  title: string,
  codes: CodeEntry[],
  x: number,
  y: number,
  totalW: number,
  cols: number = 3,
): number {
  if (!codes || codes.length === 0) return y;
  const colW = totalW / Math.max(cols, 1);
  const rowH = 3.2;

  // Title bar
  doc.setFillColor(...COLOR.BG_TABLE_HDR);
  doc.rect(x, y, totalW, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FORM_CELL_LABEL);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text(title.toUpperCase(), x + 1.5, y + 2.8);
  let curY = y + 4;

  // Code entries in columns
  for (let i = 0; i < codes.length; i++) {
    const col = i % cols;
    const cellX = x + col * colW;

    if (col === 0 && i > 0) curY += rowH;

    // Zebra stripe
    if (Math.floor(i / cols) % 2 === 0) {
      doc.setFillColor(...COLOR.BG_ZEBRA);
      if (col === 0) doc.rect(x, curY, totalW, rowH, 'F');
    }

    doc.setFont('courier', 'bold');
    doc.setFontSize(4.5);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(sanitizePdfText(codes[i].code || ''), cellX + 1, curY + 2.3);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(4);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(sanitizePdfText(`= ${codes[i].description || ''}`), cellX + 5.5, curY + 2.3, {
      maxWidth: colW - 7,
    });
  }

  curY += rowH;

  // No outer border — clean borderless style matching CFS report

  return curY;
}

/**
 * Draw a complete form section: sidebar tab + grid of rows.
 * Handles page breaks — if the section won't fit, adds a new page
 * and redraws the sidebar tab.
 * Returns Y after the section.
 */
export function drawFormSection(
  doc: jsPDF,
  config: {
    sideTab: SideTabConfig;
    rows: FormRow[];
    y: number;
    /** Additional content to draw after grid rows (callback receives y, returns new y) */
    afterGrid?: (y: number) => number;
    /** If true, render tab label as a horizontal banner above the grid instead of a vertical sidebar */
    topBanner?: boolean;
    /** Optional page break handler — called when section doesn't fit; should add page + draw continuation header, return new Y */
    onPageBreak?: (doc: jsPDF, neededH: number) => number;
  },
): number {
  const pageH = doc.internal.pageSize.getHeight();
  const bottomMargin = LAYOUT.PAGE_MARGIN + LAYOUT.FOOTER_HEIGHT + 2;
  const pageW = doc.internal.pageSize.getWidth();

  // topBanner mode uses full page width (no sidebar indent)
  const useBanner = !!config.topBanner;
  const gridX = useBanner ? LAYOUT.PAGE_MARGIN : getGridStartX();
  const gridW = useBanner
    ? pageW - 2 * LAYOUT.PAGE_MARGIN
    : getGridContentWidth(doc);

  // Calculate total section height using dynamic row heights (include banner if applicable)
  const bannerH = useBanner ? 4 : 0;
  let totalH = bannerH;
  for (const row of config.rows) {
    const autoH = computeRowHeight(doc, row.cells, gridW);
    totalH += row.height ? Math.max(row.height, autoH) : autoH;
  }

  // Check if section fits on current page
  let curY = config.y;
  if (curY + totalH > pageH - bottomMargin) {
    if (config.onPageBreak) {
      curY = config.onPageBreak(doc, totalH);
    } else {
      doc.addPage();
      curY = LAYOUT.PAGE_MARGIN; // Safe fallback — callers should provide onPageBreak
    }
  }

  const sectionStartY = curY;

  if (useBanner) {
    // ── Draw horizontal banner (matches openAutoSection header style) ──
    // Dark fill (#2a3e58 equivalent) matching CFS section headers
    const bgColor = config.sideTab.color || COLOR.BG_SECTION_HDR;
    doc.setFillColor(...bgColor);
    doc.rect(gridX, curY, gridW, bannerH, 'F');
    // Clean border around header
    doc.setDrawColor(...COLOR.BORDER_SECTION);
    doc.setLineWidth(BORDER.SECTION_OUTER);
    doc.rect(gridX, curY, gridW, bannerH);
    // White text, vertically centered
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_SECTION_TITLE);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    const bannerCapH = FONT.SIZE_SECTION_TITLE * 0.35;
    const textY = curY + (bannerH + bannerCapH) / 2;
    doc.text(sanitizePdfText(config.sideTab.label.toUpperCase()), gridX + SPACING.CONTENT_INSET + 1, textY);
    curY += bannerH + 1; // 1mm gap between banner and first grid row (tight)
  }

  // Draw grid rows
  curY = drawFormGrid(doc, config.rows, gridX, curY, gridW);

  // Draw additional content if provided
  if (config.afterGrid) {
    curY = config.afterGrid(curY);
  }

  if (useBanner) {
    // Enclosing section border around entire section (banner + grid + afterGrid)
    const totalH = curY - sectionStartY;
    // No enclosing section border — clean borderless style
  } else {
    // Draw sidebar tab spanning the full section height (legacy mode)
    const sectionH = curY - sectionStartY;
    drawSideTab(
      doc,
      config.sideTab.label,
      sectionStartY,
      sectionH,
      config.sideTab.color,
    );
  }

  return curY + SPACING.SECTION_GAP;
}

/**
 * Draw NIBRS-style form header with state identifier, ORI, form title,
 * and case number box. Returns Y after the header.
 */
export function drawNibrsHeader(
  doc: jsPDF,
  config: {
    stateIdentifier?: string;     // e.g. "STATE OF UTAH"
    agencyName: string;           // e.g. "ROCKY MOUNTAIN PROTECTIVE GROUP"
    agencyOri?: string;           // e.g. "UT0123400"
    formTitle: string;            // e.g. "UNIFORM INCIDENT REPORT"
    formNumber?: string;          // e.g. "FORM PS-101"
    caseNumber?: string;          // e.g. "INC-2026-001234"
    caseNumberLabel?: string;     // e.g. "CALL FOR SERVICE" — defaults to "CASE NUMBER"
    reportDate?: string;          // e.g. "03/02/2026"
    sealBase64?: string | null;   // Agency seal image
    logoBase64?: string | null;   // Agency logo image
  },
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = LAYOUT.PAGE_MARGIN;
  const contentW = pageW - 2 * margin;
  let y = LAYOUT.HEADER_TOP;

  // ── Top accent bar ───────────────────
  doc.setFillColor(...COLOR.BG_SECTION_HDR);
  doc.rect(margin, y, contentW, LAYOUT.HEADER_HEIGHT, 'F');

  // Seal image (left side)
  const sealSize = LAYOUT.SEAL_SIZE;
  if (config.sealBase64) {
    try {
      doc.addImage(config.sealBase64, 'PNG', margin + 3, y + 3, sealSize, sealSize);
    } catch { /* skip if image fails */ }
  }

  // Left-aligned text block (after seal)
  const textX = margin + (config.sealBase64 ? sealSize + 6 : 4);
  const headerH = LAYOUT.HEADER_HEIGHT;
  const midY = y + headerH / 2; // vertical center of header bar

  // State identifier (small, above center)
  if (config.stateIdentifier) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_SUBHEADER);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(config.stateIdentifier.toUpperCase(), textX, midY - 5);
  }

  // Agency name (main title, centered vertically)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_HEADER_TITLE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text((config.agencyName || '').toUpperCase(), textX, midY + 0.5);

  // Form title (below center)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_REPORT_TYPE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text((config.formTitle || '').toUpperCase(), textX, midY + 5.5);

  // Case number (right side — thin white border frame, white text)
  if (config.caseNumber) {
    const caseBoxW = LAYOUT.CASE_BOX_W;
    const caseBoxH = headerH - 6;
    const caseBoxX = margin + contentW - caseBoxW - 2;
    const caseBoxY = y + 3;

    // Subtle white border frame (no fill)
    doc.setDrawColor(...COLOR.TEXT_INVERTED);
    doc.setLineWidth(0.5);
    doc.rect(caseBoxX, caseBoxY, caseBoxW, caseBoxH);

    // Case number label — configurable per report type
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_FORM_CELL_LABEL);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(config.caseNumberLabel || 'CASE NUMBER', caseBoxX + caseBoxW / 2, caseBoxY + 3.5, { align: 'center' });

    // Case number value
    doc.setFont('courier', 'bold');
    doc.setFontSize(FONT.SIZE_CASE_NUMBER);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(sanitizePdfText(config.caseNumber), caseBoxX + caseBoxW / 2, caseBoxY + caseBoxH - 2, { align: 'center' });
  }

  y += LAYOUT.HEADER_HEIGHT;

  // Accent strip below header
  doc.setFillColor(...COLOR.BG_TABLE_HDR);
  doc.rect(margin, y, contentW, LAYOUT.ACCENT_STRIP_H, 'F');
  y += LAYOUT.ACCENT_STRIP_H;

  // Sub-header row: Form number (left) + Report date (right)
  y += 1;
  if (config.formNumber || config.reportDate) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_SMALL_META);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    if (config.formNumber) {
      doc.text(config.formNumber, margin + 2, y + 3);
    }
    if (config.reportDate) {
      doc.text(`REPORT DATE: ${sanitizePdfText(config.reportDate)}`, margin + contentW - 2, y + 3, { align: 'right' });
    }
    y += 5;
  }

  return y;
}

// ── NIBRS Code Constants ────────────────────────────────────

export const NIBRS_PROPERTY_CODES: CodeEntry[] = [
  { code: '01', description: 'Aircraft' },
  { code: '02', description: 'Alcohol' },
  { code: '03', description: 'Automobiles' },
  { code: '04', description: 'Bicycles' },
  { code: '05', description: 'Buses' },
  { code: '06', description: 'Clothes/Furs' },
  { code: '07', description: 'Computer Equip' },
  { code: '08', description: 'Consumable Goods' },
  { code: '09', description: 'Credit/Debit Cards' },
  { code: '10', description: 'Drugs/Narcotics' },
  { code: '11', description: 'Drug Equipment' },
  { code: '12', description: 'Farm Equipment' },
  { code: '13', description: 'Firearms' },
  { code: '14', description: 'Gambling Equip' },
  { code: '15', description: 'Heavy Construction' },
  { code: '16', description: 'Household Goods' },
  { code: '17', description: 'Jewelry/Metals' },
  { code: '18', description: 'Livestock' },
  { code: '19', description: 'Merchandise' },
  { code: '20', description: 'Money' },
  { code: '21', description: 'Negotiable Instruments' },
  { code: '22', description: 'Nonnegotiable Instruments' },
  { code: '23', description: 'Office Equipment' },
  { code: '24', description: 'Other Motor Vehicles' },
  { code: '25', description: 'Purses/Wallets' },
  { code: '26', description: 'Radios/TVs/VCRs' },
  { code: '27', description: 'Recordings' },
  { code: '28', description: 'Rec. Vehicles' },
  { code: '29', description: 'Structures' },
  { code: '77', description: 'Other' },
  { code: '88', description: 'Pending Inventory' },
];

export const NIBRS_WEAPON_CODES: CodeEntry[] = [
  { code: '11', description: 'Firearm (type unknown)' },
  { code: '12', description: 'Handgun' },
  { code: '13', description: 'Rifle' },
  { code: '14', description: 'Shotgun' },
  { code: '15', description: 'Other Firearm' },
  { code: '20', description: 'Knife/Cutting Instr.' },
  { code: '30', description: 'Blunt Object' },
  { code: '35', description: 'Motor Vehicle' },
  { code: '40', description: 'Personal Weapons' },
  { code: '50', description: 'Poison' },
  { code: '60', description: 'Explosives' },
  { code: '65', description: 'Fire/Incendiary' },
  { code: '70', description: 'Drugs/Narcotics' },
  { code: '85', description: 'Asphyxiation' },
  { code: '90', description: 'Other' },
  { code: '95', description: 'Unknown' },
  { code: '99', description: 'None' },
];

export const NIBRS_LOCATION_CODES: CodeEntry[] = [
  { code: '01', description: 'Air/Bus/Train Terminal' },
  { code: '02', description: 'Bank/Savings' },
  { code: '03', description: 'Bar/Nightclub' },
  { code: '04', description: 'Church/Synagogue' },
  { code: '05', description: 'Commercial/Office' },
  { code: '06', description: 'Construction Site' },
  { code: '07', description: 'Convenience Store' },
  { code: '08', description: 'Dept./Discount Store' },
  { code: '09', description: 'Drug Store/Pharmacy' },
  { code: '10', description: 'Field/Woods' },
  { code: '11', description: 'Government/Public' },
  { code: '12', description: 'Grocery/Supermarket' },
  { code: '13', description: 'Highway/Road' },
  { code: '14', description: 'Hotel/Motel/Etc.' },
  { code: '15', description: 'Jail/Prison' },
  { code: '16', description: 'Lake/Waterway' },
  { code: '18', description: 'Parking Lot/Garage' },
  { code: '19', description: 'Rental Storage' },
  { code: '20', description: 'Residence/Home' },
  { code: '21', description: 'Restaurant' },
  { code: '22', description: 'School/College' },
  { code: '23', description: 'Service/Gas Station' },
  { code: '24', description: 'Specialty Store' },
  { code: '25', description: 'Other/Unknown' },
];

export const NIBRS_INJURY_CODES: CodeEntry[] = [
  { code: 'N', description: 'None' },
  { code: 'B', description: 'Apparent Broken Bones' },
  { code: 'I', description: 'Possible Internal' },
  { code: 'L', description: 'Severe Laceration' },
  { code: 'M', description: 'Apparent Minor Injury' },
  { code: 'O', description: 'Other Major Injury' },
  { code: 'T', description: 'Loss of Teeth' },
  { code: 'U', description: 'Unconsciousness' },
];

export const NIBRS_CRIMINAL_ACTIVITY: CodeEntry[] = [
  { code: 'B', description: 'Buying/Receiving' },
  { code: 'C', description: 'Cultivating/Mfg' },
  { code: 'D', description: 'Distributing/Selling' },
  { code: 'E', description: 'Exploiting Children' },
  { code: 'O', description: 'Operating/Promoting' },
  { code: 'P', description: 'Possessing/Concealing' },
  { code: 'T', description: 'Transporting/Importing' },
  { code: 'U', description: 'Using/Consuming' },
  { code: 'J', description: 'Juvenile Gang' },
  { code: 'G', description: 'Organized Gang' },
];
