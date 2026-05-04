// ============================================================
// RMPG Flex — NIBRS/UCR Grid-Based Form Helpers
// Dense grid cells with inline labels, sidebar section tabs,
// compact checkbox grids, and embedded code reference tables
// Designed to replicate official law enforcement form formats
// ============================================================

import jsPDF from 'jspdf';
import bwipjs from 'bwip-js/browser';
import { sanitizePdfText, wordWrapText, getActiveSectionStyle } from './pdfGenerator';
import {
  COLOR, FONT, BORDER, SPACING, LAYOUT,
  PDF_VALUE_FONT,
  getGridStartX, getGridContentWidth,
  CLASSIFICATION,
  type RGBColor,
  type ClassificationLevel,
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

  // Cell borders drawn by drawFormRow (shared edges prevent double-lines)

  // Label (Helvetica Bold, dark gray — above value)
  const labelBaseY = y + pad + 1.2;
  if (cell.label) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    // Strip numbered prefix patterns like "1. ", "12. " from labels
    const cleanLabel = cell.label.replace(/^\d+\.\s*/, '').toUpperCase();
    doc.text(cleanLabel, x + pad, labelBaseY);
  }

  // Value area starts below label strip — 2mm gap between label and value
  const labelStripH = SPACING.FORM_CELL_LABEL_H + 0.3; // Tight gap
  const valueAreaTop = y + labelStripH + pad;
  const valueAreaH = h - labelStripH - pad;

  // Value (Courier, black — centered in value area)
  if (cell.checkbox) {
    // Render checkbox square centered vertically in value area
    const cbSize = 3.0;
    const cbX = x + pad;
    const cbY = valueAreaTop + (valueAreaH - cbSize) / 2;
    doc.setDrawColor(80, 80, 85);
    doc.setLineWidth(0.3);
    doc.rect(cbX, cbY, cbSize, cbSize);
    if (cell.checked) {
      doc.setFillColor(230, 245, 230);
      doc.rect(cbX + 0.15, cbY + 0.15, cbSize - 0.3, cbSize - 0.3, 'F');
      doc.setDrawColor(20, 20, 20);
      doc.setLineWidth(0.7);
      const cx = cbX + cbSize / 2;
      const cy = cbY + cbSize / 2;
      doc.line(cx - 1.0, cy - 0.1, cx - 0.2, cy + 0.8);
      doc.line(cx - 0.2, cy + 0.8, cx + 1.1, cy - 0.9);
    }
    // Label text after checkbox
    if (cell.value) {
      doc.setFont(PDF_VALUE_FONT, 'normal');
      doc.setFontSize(cell.valueFontSize || FONT.SIZE_FORM_CELL_VALUE);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text(cell.value, cbX + cbSize + 1, cbY + cbSize - 0.3);
    }
  } else if (cell.value) {
    doc.setFont(PDF_VALUE_FONT, cell.valueBold ? 'bold' : 'normal');
    doc.setFontSize(cell.valueFontSize || FONT.SIZE_FORM_CELL_VALUE);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);

    // Center value text baseline in the value area
    const fontSize = cell.valueFontSize || FONT.SIZE_FORM_CELL_VALUE;
    const textH = fontSize * 0.35;  // Approximate cap height in mm
    const valueY = valueAreaTop + (valueAreaH + textH) / 2;
    const maxW = w - 2 * pad;

    const displayVal = cell.value.toUpperCase();
    if (cell.align === 'center') {
      doc.text(displayVal, x + w / 2, valueY, { align: 'center', maxWidth: maxW });
    } else if (cell.align === 'right') {
      doc.text(displayVal, x + w - pad, valueY, { align: 'right', maxWidth: maxW });
    } else {
      doc.text(displayVal, x + pad, valueY, { maxWidth: maxW });
    }
  }
}

/**
 * Draw a row of adjacent form cells, distributing width by ratio.
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
  const h = rowH || SPACING.FORM_CELL_H;
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
  const startY = y;
  let curY = y;

  for (const row of rows) {
    const h = row.height || SPACING.FORM_CELL_H;
    curY = drawFormRow(doc, row.cells, x, curY, totalW, h);
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
    const labelText = sanitizePdfText(rawLabel).toUpperCase();

    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(FONT.SIZE_FORM_CELL_LABEL);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(labelText, cbX + cbSize + 0.8, cbY + cbSize - 0.2, {
      maxWidth: cellW - cbSize - 2.5,
    });
  }

  // Account for last row
  curY += rowH;

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

    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(4.5);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(sanitizePdfText(codes[i].code || '').toUpperCase(), cellX + 1, curY + 2.3);

    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(4);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(sanitizePdfText(`= ${codes[i].description || ''}`).toUpperCase(), cellX + 5.5, curY + 2.3, {
      maxWidth: colW - 7,
    });
  }

  curY += rowH;

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

  // Calculate total section height (include banner if applicable)
  // Banner: 5mm dark header bar matching CFS openAutoSection style
  const bannerH = useBanner ? 4 : 0;
  let totalH = bannerH;
  for (const row of config.rows) {
    totalH += row.height || SPACING.FORM_CELL_H;
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
    // Dark fill (#2e2e2e equivalent) matching CFS section headers
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
    curY += bannerH + SPACING.SM; // tight gap between banner and first grid row
  }

  // Draw grid rows
  curY = drawFormGrid(doc, config.rows, gridX, curY, gridW);

  // Draw additional content if provided
  if (config.afterGrid) {
    curY = config.afterGrid(curY);
  }

  if (useBanner) {
    // No extra enclosing border — rows already have shared-edge borders
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

  // Header style follows the active section style (set per-generator).
  // Default 'dark' = charcoal bar + white text (legacy NIBRS look).
  // 'light' = cream tint + gold left strip + dark text (Person PDF
  // 2026-05-04). Both keep the same layout — just colors flip — so
  // the case-number box, seal slot, and form-meta sub-row are
  // pixel-identical between modes.
  const isLight = getActiveSectionStyle() === 'light';
  const accentW = BORDER.ACCENT_SECTION;

  // ── Top header bar ───────────────────
  if (isLight) {
    // Gold left accent strip + cream tint background + outline.
    doc.setFillColor(COLOR.ACCENT_GOLD[0], COLOR.ACCENT_GOLD[1], COLOR.ACCENT_GOLD[2]);
    doc.rect(margin, y, accentW, LAYOUT.HEADER_HEIGHT, 'F');
    doc.setFillColor(...COLOR.BG_SECTION_TINT);
    doc.rect(margin + accentW, y, contentW - accentW, LAYOUT.HEADER_HEIGHT, 'F');
    doc.setDrawColor(...COLOR.BORDER_SECTION);
    doc.setLineWidth(BORDER.SECTION_OUTER);
    doc.rect(margin + accentW, y, contentW - accentW, LAYOUT.HEADER_HEIGHT);
  } else {
    // Charcoal full-width header (legacy).
    doc.setFillColor(...COLOR.BG_SECTION_HDR);
    doc.rect(margin, y, contentW, LAYOUT.HEADER_HEIGHT, 'F');
  }

  // Color tokens for text (flip per mode). Copied into mutable tuples
  // so they can be spread into jsPDF's variadic color setters — TS
  // narrows readonly tuple literals from a ternary into a union that
  // can't be spread directly.
  const headTextColor: [number, number, number] = isLight
    ? [COLOR.TEXT_PRIMARY[0], COLOR.TEXT_PRIMARY[1], COLOR.TEXT_PRIMARY[2]]
    : [COLOR.TEXT_INVERTED[0], COLOR.TEXT_INVERTED[1], COLOR.TEXT_INVERTED[2]];
  const headSubColor: [number, number, number] = isLight
    ? [COLOR.TEXT_SECONDARY[0], COLOR.TEXT_SECONDARY[1], COLOR.TEXT_SECONDARY[2]]
    : [COLOR.TEXT_INVERTED[0], COLOR.TEXT_INVERTED[1], COLOR.TEXT_INVERTED[2]];

  // Seal image — left side on dark mode (legacy), small left-of-center
  // on light mode so the centered title can breathe.
  const sealSize = LAYOUT.SEAL_SIZE;
  const sealX = margin + (isLight ? accentW + 4 : 3);
  if (config.sealBase64) {
    try {
      doc.addImage(config.sealBase64, 'PNG', sealX, y + 3, sealSize, sealSize);
    } catch { /* skip if image fails */ }
  }

  const headerH = LAYOUT.HEADER_HEIGHT;
  const midY = y + headerH / 2; // vertical center of header bar

  if (isLight) {
    // ── Light mode — POLICE-DEPARTMENT CENTERED LAYOUT ──
    // Agency name centered like a real PD letterhead, with state
    // identifier above and form title below. The case-number /
    // subject-name box is INTENTIONALLY OMITTED on light mode because
    // the quick-reference banner directly below already shows the
    // identifier in larger type — repeating it in the upper-right made
    // every Person/Call report show the subject name twice (visible in
    // 2026-05-04 user feedback).
    const centerX = margin + contentW / 2;

    if (config.stateIdentifier) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT.SIZE_SUBHEADER);
      doc.setTextColor(...headSubColor);
      doc.text(config.stateIdentifier.toUpperCase(), centerX, midY - 5, { align: 'center' });
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_HEADER_TITLE);
    doc.setTextColor(...headTextColor);
    doc.text((config.agencyName || '').toUpperCase(), centerX, midY + 0.5, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_REPORT_TYPE);
    doc.setTextColor(...headTextColor);
    doc.text((config.formTitle || '').toUpperCase(), centerX, midY + 5.5, { align: 'center' });
  } else {
    // ── Dark mode (legacy) — left-aligned text + case-number box right ──
    const textX = config.sealBase64 ? sealX + sealSize + 4 : margin + 4;

    if (config.stateIdentifier) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT.SIZE_SUBHEADER);
      doc.setTextColor(...headSubColor);
      doc.text(config.stateIdentifier.toUpperCase(), textX, midY - 5);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_HEADER_TITLE);
    doc.setTextColor(...headTextColor);
    doc.text((config.agencyName || '').toUpperCase(), textX, midY + 0.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_REPORT_TYPE);
    doc.setTextColor(...headTextColor);
    doc.text((config.formTitle || '').toUpperCase(), textX, midY + 5.5);

    // Case-number box — only on dark mode; light mode banner below
    // shows the identifier already.
    if (config.caseNumber) {
      const caseBoxW = LAYOUT.CASE_BOX_W;
      const caseBoxH = headerH - 6;
      const caseBoxX = margin + contentW - caseBoxW - 2;
      const caseBoxY = y + 3;

      doc.setDrawColor(...headTextColor);
      doc.setLineWidth(0.5);
      doc.rect(caseBoxX, caseBoxY, caseBoxW, caseBoxH);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT.SIZE_FORM_CELL_LABEL);
      doc.setTextColor(...headSubColor);
      doc.text(config.caseNumberLabel || 'CASE NUMBER', caseBoxX + caseBoxW / 2, caseBoxY + 3.5, { align: 'center' });

      doc.setFont(PDF_VALUE_FONT, 'bold');
      const caseNumberText = sanitizePdfText(config.caseNumber);
      const availW = caseBoxW - 3;
      let caseFontSize: number = FONT.SIZE_CASE_NUMBER;
      doc.setFontSize(caseFontSize);
      let measuredW = doc.getTextWidth(caseNumberText);
      if (measuredW > availW && measuredW > 0) {
        caseFontSize = Math.max(5, caseFontSize * (availW / measuredW));
        doc.setFontSize(caseFontSize);
      }
      doc.setTextColor(...headTextColor);
      doc.text(caseNumberText, caseBoxX + caseBoxW / 2, caseBoxY + caseBoxH - 2, { align: 'center' });
    }
  }

  y += LAYOUT.HEADER_HEIGHT;

  // Accent strip below header — gold on light mode, slate on dark.
  if (isLight) {
    doc.setFillColor(COLOR.ACCENT_GOLD[0], COLOR.ACCENT_GOLD[1], COLOR.ACCENT_GOLD[2]);
  } else {
    doc.setFillColor(...COLOR.BG_TABLE_HDR);
  }
  doc.rect(margin, y, contentW, LAYOUT.ACCENT_STRIP_H, 'F');
  y += LAYOUT.ACCENT_STRIP_H;

  // Sub-header row: Form number (left) + Report date (right)
  y += 1;
  if (config.formNumber || config.reportDate) {
    doc.setFont(PDF_VALUE_FONT, 'bold');
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

/**
 * Draw the geography / contract strip row below the NIBRS header.
 * Renders: AREA | SECTOR | ZONE | BEAT | CONTRACT ID
 * Each cell is a labeled box matching field-pair style, full-width.
 * All values forced to UPPERCASE for professional police-report style.
 */
export function drawGeographyStrip(
  doc: jsPDF,
  y: number,
  data: {
    area?: string | null;
    sector?: string | null;   // displayed from sector_id/sector_id
    zone?: string | null;
    beat?: string | null;
    contract_id?: string | null;
  },
): number {
  const margin = LAYOUT.PAGE_MARGIN;
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - 2 * margin;
  const cellW = contentW / 5;
  const stripH = 6.5;

  // Gold top border (ties to section header accent)
  doc.setFillColor(...COLOR.ACCENT_GOLD);
  doc.rect(margin, y, contentW, 0.5, 'F');

  // Cell background (light tint)
  doc.setFillColor(...COLOR.BG_SECTION_TINT);
  doc.rect(margin, y + 0.5, contentW, stripH - 0.5, 'F');

  // Bottom border
  doc.setDrawColor(...COLOR.BORDER_SECTION);
  doc.setLineWidth(0.2);
  doc.line(margin, y + stripH, margin + contentW, y + stripH);

  // Strip parent context from each tier — Section/Zone/Beat each get
  // their own column, so repeating the parent inside the child is noise.
  // (zoneLeaf("SL1-HER") → "HER"; beatLeaf("SL1-HER/C") → "C")
  const sectorVal = data.sector || '—';
  const zoneVal = data.zone ? (data.zone.indexOf('-') >= 0 ? data.zone.slice(data.zone.indexOf('-') + 1) : data.zone) : '—';
  const beatVal = data.beat ? (data.beat.lastIndexOf('/') >= 0 ? data.beat.slice(data.beat.lastIndexOf('/') + 1) : data.beat) : '—';
  const labels = ['AREA', 'SECTION', 'ZONE', 'BEAT', 'CONTRACT ID'];
  const values = [
    data.area || '—',
    sectorVal,
    zoneVal,
    beatVal,
    data.contract_id || '—',
  ];

  for (let i = 0; i < 5; i++) {
    const cellX = margin + i * cellW;
    // Column separator (except before first)
    if (i > 0) {
      doc.setDrawColor(...COLOR.BORDER_COLUMN);
      doc.setLineWidth(0.2);
      doc.line(cellX, y, cellX, y + stripH);
    }
    // Label (top of cell)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(labels[i], cellX + 1.5, y + 2.2);
    // Value (bottom of cell, monospace, UPPERCASE)
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_VALUE);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    const val = String(values[i]).toUpperCase();
    // Truncate to fit cell
    const maxChars = Math.floor((cellW - 3) / 1.5);
    const displayVal = val.length > maxChars ? val.slice(0, maxChars - 1) + '…' : val;
    doc.text(displayVal, cellX + 1.5, y + 5.5);
  }

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + stripH + 1;
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

// ============================================================
// Police-Form Furniture (added 2026-04-17)
// Classification banners, caution strips, priority bars, dispatch
// timeline, chain of custody, officer certification, Bates stamps,
// Code 39 barcodes, mugshot frames.
// ============================================================

// ── Classification Banner ───────────────────────────────────

/**
 * Draw a CJIS-style classification banner (LES, CUI, FOUO, etc.).
 * Called twice per page: once at top (above header), once at bottom (below footer).
 * Returns Y after the bar.
 */
export function drawClassificationBar(
  doc: jsPDF,
  level: ClassificationLevel,
  y: number,
  opts?: { position?: 'top' | 'bottom'; customLabel?: string },
): number {
  const spec = CLASSIFICATION[level];
  if (!spec) return y;
  const pageW = doc.internal.pageSize.getWidth();
  const margin = LAYOUT.PAGE_MARGIN;
  const w = pageW - 2 * margin;
  const h = SPACING.CLASSIFICATION_BAR_H;

  // Solid colored fill
  doc.setFillColor(...spec.bg);
  doc.rect(margin, y, w, h, 'F');

  // Label, centered
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_CLASSIFICATION);
  doc.setTextColor(...spec.fg);
  const label = sanitizePdfText(opts?.customLabel || spec.label);
  const capH = FONT.SIZE_CLASSIFICATION * 0.35;
  doc.text(label, margin + w / 2, y + (h + capH) / 2, { align: 'center' });

  // Gold rule: under top bar, above bottom bar
  doc.setDrawColor(...COLOR.RULE_GOLD);
  doc.setLineWidth(BORDER.CLASSIFICATION_RULE);
  const isTop = opts?.position !== 'bottom';
  const ruleY = isTop ? y + h + 0.3 : y - 0.3;
  doc.line(margin, ruleY, margin + w, ruleY);

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return isTop ? ruleY + 0.8 : y + h;
}

/**
 * Apply classification banners to EVERY page of a completed PDF.
 * Call as the last step before doc.save() / doc.output().
 */
export function applyClassificationToAllPages(
  doc: jsPDF,
  level: ClassificationLevel,
): void {
  const total = doc.getNumberOfPages();
  const pageH = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawClassificationBar(doc, level, 2, { position: 'top' });
    drawClassificationBar(doc, level, pageH - 2 - SPACING.CLASSIFICATION_BAR_H, {
      position: 'bottom',
    });
  }
}

// ── Caution / Officer-Safety Flag Strip ─────────────────────

export interface CautionFlag {
  label: string;            // "ARMED & DANGEROUS"
  color?: RGBColor;         // Override chip color (default from COLOR.FLAG_*)
  kind?: 'armed' | 'warrant' | 'gang' | 'mental' | 'medical' | 'violent' | 'default';
}

function flagColor(flag: CautionFlag): RGBColor {
  if (flag.color) return flag.color;
  switch (flag.kind) {
    case 'armed':   return COLOR.FLAG_ARMED;
    case 'warrant': return COLOR.FLAG_WARRANT;
    case 'gang':    return COLOR.FLAG_GANG;
    case 'mental':  return COLOR.FLAG_MENTAL;
    case 'medical': return COLOR.FLAG_MEDICAL;
    case 'violent': return COLOR.FLAG_ARMED;
    default:        return COLOR.FLAG_DEFAULT;
  }
}

/**
 * Draw a red "CAUTION — OFFICER SAFETY" banner with horizontal flag chips.
 * Returns Y after the strip.
 */
export function drawCautionFlagStrip(
  doc: jsPDF,
  flags: CautionFlag[],
  y: number,
): number {
  if (!flags || flags.length === 0) return y;
  const pageW = doc.internal.pageSize.getWidth();
  const margin = LAYOUT.PAGE_MARGIN;
  const w = pageW - 2 * margin;
  const h = SPACING.CAUTION_STRIP_H;

  // Dark red banner background
  doc.setFillColor(...COLOR.FLAG_ARMED);
  doc.rect(margin, y, w, h, 'F');
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(BORDER.CAUTION_STRIP);
  doc.rect(margin, y, w, h);

  // Yellow warning triangle on left
  const triX = margin + 2.5;
  const triY = y + h / 2;
  doc.setFillColor(255, 210, 40);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  // Equilateral triangle pointing up
  const tSize = 2.6;
  doc.triangle(
    triX, triY + tSize,
    triX - tSize, triY - tSize * 0.6,
    triX + tSize, triY - tSize * 0.6,
    'FD',
  );
  // Exclamation
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.setTextColor(0, 0, 0);
  doc.text('!', triX, triY + 0.7, { align: 'center' });

  // Banner label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_CAUTION_LABEL);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  const labelCap = FONT.SIZE_CAUTION_LABEL * 0.35;
  const labelX = triX + tSize + 2.5;
  doc.text('CAUTION -- OFFICER SAFETY', labelX, y + (h + labelCap) / 2);

  // Flag chips on right side
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_CAUTION_CHIP);
  const chipPadX = 1.8;
  const chipH = h - 2;
  const chipY = y + 1;
  let chipX = margin + w - 2;

  // Measure + lay out chips right-to-left so they pack against right edge
  const chipSpecs = flags.map((f) => {
    const lbl = sanitizePdfText(f.label.toUpperCase());
    const tw = doc.getTextWidth(lbl);
    return { f, lbl, w: tw + chipPadX * 2 };
  });
  // Reverse-iterate so right-most chip is the first flag
  for (let i = chipSpecs.length - 1; i >= 0; i--) {
    const { f, lbl, w: cw } = chipSpecs[i];
    chipX -= cw;
    if (chipX < labelX + 55) break; // Out of room — stop chipping
    const col = flagColor(f);
    doc.setFillColor(...col);
    doc.setDrawColor(...COLOR.TEXT_INVERTED);
    doc.setLineWidth(0.3);
    doc.rect(chipX, chipY, cw, chipH, 'FD');
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(lbl, chipX + cw / 2, chipY + chipH - 1.3, { align: 'center' });
    chipX -= 1.5; // gap between chips
  }

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + h + SPACING.SM;
}

// ── Priority Bar (CAD-style) ────────────────────────────────

export type PriorityLevel = 1 | 2 | 3 | 4;

const PRIO_BG: Record<PriorityLevel, RGBColor> = {
  1: COLOR.PRIO_1_BG,
  2: COLOR.PRIO_2_BG,
  3: COLOR.PRIO_3_BG,
  4: COLOR.PRIO_4_BG,
};

const PRIO_LABEL: Record<PriorityLevel, string> = {
  1: 'PRIORITY 1 -- EMERGENCY / CODE 3',
  2: 'PRIORITY 2 -- URGENT RESPONSE',
  3: 'PRIORITY 3 -- ROUTINE',
  4: 'PRIORITY 4 -- NON-EMERGENCY / INFO',
};

/**
 * Draw a full-width priority bar (color-coded CAD console style).
 * Returns Y after the bar.
 */
export function drawPriorityBar(
  doc: jsPDF,
  priority: PriorityLevel,
  y: number,
  opts?: { customLabel?: string },
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = LAYOUT.PAGE_MARGIN;
  const w = pageW - 2 * margin;
  const h = SPACING.PRIORITY_BAR_H;

  const bg = PRIO_BG[priority] || COLOR.PRIO_3_BG;
  doc.setFillColor(...bg);
  doc.rect(margin, y, w, h, 'F');

  // Left "PRIORITY n" badge block — slightly darker
  const badgeW = 24;
  doc.setFillColor(
    Math.max(0, bg[0] - 30),
    Math.max(0, bg[1] - 30),
    Math.max(0, bg[2] - 30),
  );
  doc.rect(margin, y, badgeW, h, 'F');

  // Badge text "P1"
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_PRIORITY_BAR);
  doc.setTextColor(...COLOR.PRIO_FG);
  const capH = FONT.SIZE_PRIORITY_BAR * 0.35;
  doc.text(`P${priority}`, margin + badgeW / 2, y + (h + capH) / 2, { align: 'center' });

  // Main label
  doc.setFontSize(FONT.SIZE_PRIORITY_BAR - 1);
  const label = sanitizePdfText(opts?.customLabel || PRIO_LABEL[priority]);
  doc.text(label, margin + badgeW + 3, y + (h + capH) / 2);

  // Outer border
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setLineWidth(BORDER.PRIORITY_BAR);
  doc.rect(margin, y, w, h);

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + h + SPACING.SM;
}

// ── Dispatch Timeline Strip ─────────────────────────────────

export interface TimelineEvent {
  label: string;   // "RECEIVED", "DISPATCHED", "EN ROUTE", "ON SCENE", "CLEARED"
  time?: string;   // "14:23:07"
  elapsed?: string; // "+00:02:14" — delta from previous stage
}

/**
 * Draw a CAD-console style dispatch timeline strip.
 * Renders one cell per event with label top, time middle, delta bottom.
 * Returns Y after the strip.
 */
export function drawDispatchTimelineStrip(
  doc: jsPDF,
  events: TimelineEvent[],
  y: number,
): number {
  if (!events || events.length === 0) return y;
  const pageW = doc.internal.pageSize.getWidth();
  const margin = LAYOUT.PAGE_MARGIN;
  const w = pageW - 2 * margin;
  const h = SPACING.TIMELINE_ROW_H;
  const cellW = w / events.length;

  // Outer border
  doc.setDrawColor(...COLOR.BORDER_OUTER);
  doc.setLineWidth(BORDER.TIMELINE_OUTER);
  doc.rect(margin, y, w, h);

  // Header strip (dark)
  const headerH = 2.6;
  doc.setFillColor(...COLOR.BG_TABLE_HDR);
  doc.rect(margin, y, w, headerH, 'F');

  for (let i = 0; i < events.length; i++) {
    const cellX = margin + i * cellW;
    // Vertical divider
    if (i > 0) {
      doc.setDrawColor(...COLOR.BORDER_COLUMN);
      doc.setLineWidth(BORDER.TIMELINE_CELL);
      doc.line(cellX, y, cellX, y + h);
    }

    // Stage label in header strip
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_TIMELINE_LABEL);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(
      sanitizePdfText(events[i].label.toUpperCase()),
      cellX + cellW / 2,
      y + 1.9,
      { align: 'center' },
    );

    // Timestamp (bold courier, center)
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_TIMELINE_VALUE);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(
      sanitizePdfText(events[i].time || '--:--:--'),
      cellX + cellW / 2,
      y + headerH + 3.2,
      { align: 'center' },
    );

    // Elapsed delta
    if (events[i].elapsed) {
      doc.setFont(PDF_VALUE_FONT, 'normal');
      doc.setFontSize(FONT.SIZE_TIMELINE_LABEL);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text(
        sanitizePdfText(events[i].elapsed!),
        cellX + cellW / 2,
        y + h - 1.1,
        { align: 'center' },
      );
    }

    // Progress LED between stages
    if (i < events.length - 1 && events[i].time) {
      const ledX = cellX + cellW - 1.5;
      const ledY = y + headerH + 1.5;
      doc.setFillColor(60, 180, 80);
      doc.circle(ledX, ledY, 0.5, 'F');
    }
  }

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + h + SPACING.SM;
}

// ── Chain of Custody Table ──────────────────────────────────

export interface CustodyTransfer {
  dateTime?: string;
  releasedBy?: string;
  releasedSig?: string;
  receivedBy?: string;
  receivedSig?: string;
  purpose?: string;
  location?: string;
}

/**
 * Draw a chain-of-custody ledger with pre-drawn signature lines.
 * Minimum 5 rows even if fewer transfers provided (for in-field pen entries).
 * Returns Y after the table.
 */
export function drawChainOfCustodyTable(
  doc: jsPDF,
  transfers: CustodyTransfer[],
  x: number,
  y: number,
  w: number,
  opts?: { minRows?: number; itemDescription?: string; itemNumber?: string },
): number {
  const minRows = opts?.minRows ?? 5;
  const rowH = SPACING.COC_ROW_H;
  const headerH = SPACING.COC_HEADER_H;
  const rows = [...transfers];
  while (rows.length < minRows) rows.push({});

  // Item identification strip (if provided)
  let curY = y;
  if (opts?.itemNumber || opts?.itemDescription) {
    const stripH = 4;
    doc.setFillColor(...COLOR.BG_SECTION_HDR);
    doc.rect(x, curY, w, stripH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_SECTION_TITLE);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    const lbl = `CHAIN OF CUSTODY` +
      (opts.itemNumber ? `  |  ITEM #${sanitizePdfText(opts.itemNumber)}` : '') +
      (opts.itemDescription ? `  |  ${sanitizePdfText(opts.itemDescription).toUpperCase()}` : '');
    doc.text(lbl, x + 1.5, curY + 2.8);
    curY += stripH;
  }

  // Column layout: date/time 18% | released (sig+name) 26% | received (sig+name) 26% | purpose 18% | location 12%
  const colW = [w * 0.18, w * 0.26, w * 0.26, w * 0.18, w * 0.12];
  const colX: number[] = [];
  let cx = x;
  for (const c of colW) { colX.push(cx); cx += c; }

  // Header row
  doc.setFillColor(...COLOR.BG_TABLE_HDR);
  doc.rect(x, curY, w, headerH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_COC_HEADER);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  const headers = ['DATE / TIME', 'RELEASED BY (SIGNATURE)', 'RECEIVED BY (SIGNATURE)', 'PURPOSE', 'LOCATION'];
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], colX[i] + 1, curY + headerH - 1.4);
  }
  curY += headerH;

  // Data rows
  doc.setDrawColor(...COLOR.BORDER_OUTER);
  doc.setLineWidth(BORDER.COC_OUTER);
  const tableStartY = curY - headerH;

  for (let r = 0; r < rows.length; r++) {
    // Zebra stripe
    if (r % 2 === 1) {
      doc.setFillColor(...COLOR.BG_ZEBRA);
      doc.rect(x, curY, w, rowH, 'F');
    }
    const row = rows[r];

    // Date/time
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_COC_VALUE);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(sanitizePdfText(row.dateTime || ''), colX[0] + 1, curY + 3.5);

    // Signature line + name for released / received
    for (let k = 0; k < 2; k++) {
      const colIdx = 1 + k;
      const sig = k === 0 ? row.releasedSig : row.receivedSig;
      const nm  = k === 0 ? row.releasedBy  : row.receivedBy;
      const sigY = curY + 5.5;
      // Signature line
      doc.setDrawColor(...COLOR.TEXT_PRIMARY);
      doc.setLineWidth(BORDER.SIGNATURE_LINE);
      doc.line(colX[colIdx] + 1, sigY, colX[colIdx] + colW[colIdx] - 1, sigY);
      if (sig) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7);
        doc.text(sanitizePdfText(sig), colX[colIdx] + 2, sigY - 0.5);
      }
      // Printed name below
      doc.setFont(PDF_VALUE_FONT, 'normal');
      doc.setFontSize(FONT.SIZE_COC_VALUE - 0.5);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text(sanitizePdfText(nm || ''), colX[colIdx] + 1, sigY + 2.8);
    }

    // Purpose
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(FONT.SIZE_COC_VALUE);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(
      sanitizePdfText((row.purpose || '').toUpperCase()),
      colX[3] + 1,
      curY + 3.5,
      { maxWidth: colW[3] - 2 },
    );

    // Location
    doc.text(
      sanitizePdfText((row.location || '').toUpperCase()),
      colX[4] + 1,
      curY + 3.5,
      { maxWidth: colW[4] - 2 },
    );

    // Row separator
    doc.setDrawColor(...COLOR.BORDER_TABLE);
    doc.setLineWidth(BORDER.COC_ROW);
    doc.line(x, curY + rowH, x + w, curY + rowH);

    curY += rowH;
  }

  // Column dividers (drawn once over the full table height)
  doc.setDrawColor(...COLOR.BORDER_COLUMN);
  doc.setLineWidth(BORDER.COC_ROW);
  for (let i = 1; i < colX.length; i++) {
    doc.line(colX[i], tableStartY, colX[i], curY);
  }

  // Outer border
  doc.setDrawColor(...COLOR.BORDER_OUTER);
  doc.setLineWidth(BORDER.COC_OUTER);
  doc.rect(x, tableStartY, w, curY - tableStartY);

  return curY + SPACING.SM;
}

// ── Officer Certification Block ─────────────────────────────

export interface OfficerSignatureSlot {
  role: string;           // "REPORTING OFFICER", "SUPERVISOR", "REVIEWING OFFICER"
  name?: string;
  badge?: string;
  postCert?: string;
  date?: string;
  signatureImg?: string;  // Base64 image if digitally signed
}

/**
 * Draw certification paragraph + split signature block.
 * Returns Y after the block.
 */
export function drawOfficerCertificationBlock(
  doc: jsPDF,
  slots: OfficerSignatureSlot[],
  x: number,
  y: number,
  w: number,
  opts?: {
    certText?: string;
    certHeading?: string;
  },
): number {
  const heading = opts?.certHeading || 'OFFICER CERTIFICATION';
  const certBody = opts?.certText ||
    'I, the undersigned, certify under penalty of perjury pursuant to Utah Code ' +
    'Sect. 76-8-504 that the foregoing report is true and correct to the best of my ' +
    'knowledge and was prepared in the regular course of law enforcement duties. ' +
    'Falsification of this report is a Class A misdemeanor.';

  // Heading bar
  const headH = 4;
  doc.setFillColor(...COLOR.BG_SECTION_HDR);
  doc.rect(x, y, w, headH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_SECTION_TITLE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text(heading, x + 1.5, y + headH - 1.3);
  let curY = y + headH;

  // Certification paragraph box
  const paraH = SPACING.CERT_PARA_H;
  doc.setFillColor(...COLOR.CERT_BG);
  doc.rect(x, curY, w, paraH, 'F');
  doc.setDrawColor(...COLOR.CERT_RULE);
  doc.setLineWidth(BORDER.CERT_BOX);
  doc.rect(x, curY, w, paraH);

  // Italic justified cert text
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(FONT.SIZE_CERTIFICATION);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  const lines = wordWrapText(doc, sanitizePdfText(certBody), w - 4);
  let lineY = curY + 2.6;
  for (const line of lines) {
    doc.text(line, x + 2, lineY);
    lineY += 2.4;
  }
  curY += paraH;

  // Signature row(s) — up to 2 per physical row, wrapping as needed
  const slotsPerRow = 2;
  const slotW = w / slotsPerRow;
  const sigH = SPACING.CERT_SIG_H;

  for (let i = 0; i < slots.length; i++) {
    const col = i % slotsPerRow;
    if (col === 0 && i > 0) curY += sigH;
    const sx = x + col * slotW;
    drawSignatureSlot(doc, slots[i], sx, curY, slotW, sigH);
  }
  curY += sigH;

  // Outer border around whole block
  doc.setDrawColor(...COLOR.BORDER_OUTER);
  doc.setLineWidth(BORDER.CERT_BOX);
  doc.rect(x, y, w, curY - y);

  return curY + SPACING.SM;
}

function drawSignatureSlot(
  doc: jsPDF,
  slot: OfficerSignatureSlot,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  // Role label strip at top
  doc.setFillColor(245, 245, 248);
  doc.rect(x, y, w, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_BADGE_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(sanitizePdfText(slot.role.toUpperCase()), x + 1.5, y + 2.2);

  // Signature line
  const sigY = y + 7.5;
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setLineWidth(BORDER.SIGNATURE_LINE);
  doc.line(x + 1.5, sigY, x + w - 1.5, sigY);

  // Optional signature image
  if (slot.signatureImg) {
    try {
      doc.addImage(slot.signatureImg, 'PNG', x + 3, y + 3, w - 6, 4.2);
    } catch { /* skip on failure */ }
  } else {
    // X marker on line
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_SIGNATURE_X);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('X', x + 2, sigY - 0.3);
  }

  // Bottom row: printed name (2/4) | badge (1/4) | POST (1/4) | date (overlay under signature)
  const rowY = sigY + 3;
  const quarterW = (w - 3) / 4;
  // Printed name (spans 2)
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_BADGE_VALUE);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(sanitizePdfText((slot.name || '').toUpperCase()), x + 1.5, rowY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_BADGE_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text('PRINTED NAME', x + 1.5, rowY + 2.2);

  // Badge
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_BADGE_VALUE);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(sanitizePdfText(slot.badge || ''), x + 1.5 + 2 * quarterW, rowY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_BADGE_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text('BADGE #', x + 1.5 + 2 * quarterW, rowY + 2.2);

  // POST
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_BADGE_VALUE);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(sanitizePdfText(slot.postCert || ''), x + 1.5 + 3 * quarterW, rowY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_BADGE_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text('POST #', x + 1.5 + 3 * quarterW, rowY + 2.2);

  // Date (right-aligned above signature line)
  if (slot.date) {
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_BADGE_VALUE);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(
      sanitizePdfText(slot.date),
      x + w - 1.5,
      sigY - 0.6,
      { align: 'right' },
    );
  }

  // Divider between slots
  doc.setDrawColor(...COLOR.BORDER_COLUMN);
  doc.setLineWidth(0.2);
  doc.line(x + w, y + 1, x + w, y + h - 1);
}

// ── Bates Stamp ─────────────────────────────────────────────

/**
 * Draw a Bates stamp in the bottom-right of the current page.
 * Sequence numbers are zero-padded to 6 digits: RMPG-000142
 */
export function drawBatesStamp(
  doc: jsPDF,
  sequence: number,
  opts?: { prefix?: string; xOffset?: number; yOffset?: number },
): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const prefix = opts?.prefix || 'RMPG-';
  const seq = String(sequence).padStart(6, '0');
  const label = `${prefix}${seq}`;

  const xOff = opts?.xOffset ?? 0;
  const yOff = opts?.yOffset ?? 0;
  const x = pageW - LAYOUT.PAGE_MARGIN - xOff - 1;
  const y = pageH - LAYOUT.PAGE_MARGIN - 6 - yOff;

  // Small bordered rectangle, burgundy text
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_BATES);
  const tw = doc.getTextWidth(label);
  const boxW = tw + 4;
  const boxH = 4.2;
  doc.setDrawColor(...COLOR.BATES_STAMP);
  doc.setLineWidth(0.3);
  doc.rect(x - boxW, y, boxW, boxH);
  doc.setTextColor(...COLOR.BATES_STAMP);
  doc.text(label, x - 2, y + boxH - 1.3, { align: 'right' });

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
}

/**
 * Apply sequential Bates stamps to every page of the finalized document.
 * Sequence increments page-by-page starting from `startSequence`.
 */
export function applyBatesToAllPages(
  doc: jsPDF,
  startSequence: number = 1,
  opts?: { prefix?: string },
): void {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawBatesStamp(doc, startSequence + (p - 1), opts);
  }
}

// ── Code 39 Barcode ─────────────────────────────────────────
// Self-contained Code 39 renderer — no external library.
// Character set: 0-9 A-Z space - . $ / + %, plus * start/stop.
// Each character is 9 bars: 5 black, 4 white, 3 of which are wide (2:1 ratio).

const CODE39_MAP: Record<string, string> = {
  // "B" = narrow bar, "b" = wide bar, "W" = narrow space, "w" = wide space
  '0': 'BWBwBWbWB', '1': 'bWBwBWBWb', '2': 'BWbwBWBWb', '3': 'bWbwBWBWB',
  '4': 'BWBwbWBWb', '5': 'bWBwbWBWB', '6': 'BWbwbWBWB', '7': 'BWBwBWbWb',
  '8': 'bWBwBWbWB', '9': 'BWbwBWbWB',
  'A': 'bWBWBwBWb', 'B': 'BWbWBwBWb', 'C': 'bWbWBwBWB',
  'D': 'BWBWbwBWb', 'E': 'bWBWbwBWB', 'F': 'BWbWbwBWB',
  'G': 'BWBWBwbWb', 'H': 'bWBWBwbWB', 'I': 'BWbWBwbWB',
  'J': 'BWBWbwbWB', 'K': 'bWBWBWBwb', 'L': 'BWbWBWBwb',
  'M': 'bWbWBWBwB', 'N': 'BWBWbWBwb', 'O': 'bWBWbWBwB',
  'P': 'BWbWbWBwB', 'Q': 'BWBWBWbwb', 'R': 'bWBWBWbwB',
  'S': 'BWbWBWbwB', 'T': 'BWBWbWbwB',
  'U': 'bwBWBWBWb', 'V': 'BwbWBWBWb', 'W': 'bwbWBWBWB',
  'X': 'BwBWbWBWb', 'Y': 'bwBWbWBWB', 'Z': 'BwbWbWBWB',
  '-': 'BwBWBWbWb', '.': 'bwBWBWbWB', ' ': 'BwbWBWbWB',
  '*': 'BwBWbWbWB',
  '$': 'BwBwBwBWB', '/': 'BwBwBWBwB', '+': 'BwBWBwBwB', '%': 'BWBwBwBwB',
};

/**
 * Draw a Code 39 barcode. Value is uppercased and non-supported chars are skipped.
 * Start/stop asterisks are added automatically.
 * Returns the actual width of the rendered barcode in mm.
 */
export function drawCode39Barcode(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  maxW: number,
  h: number,
  opts?: { showText?: boolean; narrowMm?: number },
): number {
  const text = (value || '').toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '');
  if (!text) return 0;
  const encoded = `*${text}*`;

  // Each character = 9 bars + 1 inter-char gap (narrow). Total narrow units per char:
  // 6 narrow (5 bars + 1 space) + 3 wide-ratio units (3 wide bars at 2x) = effectively
  // 6 + 3*3 = 13 narrow widths + 1 gap = ~16 narrow units per char. Then start/stop adds 2 chars.
  const NARROW_RATIO = 1;
  const WIDE_RATIO = 2.5;
  const CHAR_GAP = NARROW_RATIO;

  // Compute total narrow units
  let totalUnits = 0;
  for (const ch of encoded) {
    const pattern = CODE39_MAP[ch];
    if (!pattern) continue;
    for (const p of pattern) {
      totalUnits += (p === 'B' || p === 'W') ? NARROW_RATIO : WIDE_RATIO;
    }
    totalUnits += CHAR_GAP;
  }
  totalUnits -= CHAR_GAP; // trailing gap not needed
  totalUnits += 2 * SPACING.BARCODE_QUIET; // quiet zones

  const narrowMm = opts?.narrowMm ?? (maxW / totalUnits);
  const wideMm = narrowMm * WIDE_RATIO;
  const textH = opts?.showText === false ? 0 : 2.2;
  const barH = h - textH;

  // Quiet zone left
  let curX = x + SPACING.BARCODE_QUIET * narrowMm;

  doc.setFillColor(...COLOR.BARCODE_BAR);
  for (const ch of encoded) {
    const pattern = CODE39_MAP[ch];
    if (!pattern) continue;
    for (const p of pattern) {
      const isBar = p === 'B' || p === 'b';
      const isWide = p === 'b' || p === 'w';
      const segW = isWide ? wideMm : narrowMm;
      if (isBar) {
        doc.rect(curX, y, segW, barH, 'F');
      }
      curX += segW;
    }
    // Inter-character gap (white narrow)
    curX += narrowMm * CHAR_GAP;
  }

  // Human-readable label below
  if (opts?.showText !== false) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_BARCODE_LABEL);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    const totalW = curX - x;
    doc.text(
      `*${text}*`,
      x + totalW / 2,
      y + barH + textH - 0.4,
      { align: 'center' },
    );
  }

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return curX - x;
}

// ── Barcode Scan Strip (top of page) ────────────────────────

/**
 * Full-width barcode scan strip (placed above header or below classification).
 * Left: barcode, Right: human-readable case number + generated timestamp.
 * Returns Y after the strip.
 */
export function drawBarcodeScanStrip(
  doc: jsPDF,
  y: number,
  data: {
    caseNumber: string;
    formNumber?: string;
    generatedAt?: string;
    agencyOri?: string;
  },
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = LAYOUT.PAGE_MARGIN;
  const w = pageW - 2 * margin;
  const h = SPACING.BARCODE_STRIP_H;

  // Background
  doc.setFillColor(...COLOR.BARCODE_STRIP_BG);
  doc.rect(margin, y, w, h, 'F');
  doc.setDrawColor(...COLOR.BARCODE_STRIP_RULE);
  doc.setLineWidth(BORDER.BARCODE_STRIP);
  doc.rect(margin, y, w, h);

  // Left third: barcode
  const barcodeW = w * 0.42;
  const barcodePad = 1.5;
  drawCode39Barcode(
    doc,
    data.caseNumber,
    margin + barcodePad,
    y + 0.8,
    barcodeW - 2 * barcodePad,
    h - 1.6,
    { showText: true },
  );

  // Right portion: stacked metadata
  const rightX = margin + barcodeW + 3;
  const rightW = w - barcodeW - 4;

  // "CASE NO." label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_BADGE_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text('CASE NO.', rightX, y + 2.2);

  // Case number value (large monospace)
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_BARCODE_STRIP);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(
    sanitizePdfText(data.caseNumber.toUpperCase()),
    rightX + 18,
    y + 3.3,
  );

  // Form/ORI line
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_ORI_LINE);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  const metaParts: string[] = [];
  if (data.formNumber) metaParts.push(`FORM ${data.formNumber}`);
  if (data.agencyOri) metaParts.push(`ORI ${data.agencyOri}`);
  if (metaParts.length) {
    doc.text(sanitizePdfText(metaParts.join('  |  ')), rightX, y + h - 2.2);
  }

  // Generated timestamp (right-aligned)
  if (data.generatedAt) {
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(FONT.SIZE_ORI_LINE);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(
      `GEN: ${sanitizePdfText(data.generatedAt)}`,
      margin + w - 2,
      y + h - 2.2,
      { align: 'right' },
    );
  }

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + h + SPACING.SM;
}

// ── Mugshot Frame ───────────────────────────────────────────

export interface MugshotMeta {
  arrestDate?: string;
  bookingNumber?: string;
  agencyOri?: string;
  sid?: string;
  fbiNumber?: string;
}

/**
 * Render arrest photo in a framed box with caption strip.
 * If no image, renders placeholder.
 */
export function drawMugshotFrame(
  doc: jsPDF,
  imgBase64: string | null | undefined,
  meta: MugshotMeta,
  x: number,
  y: number,
  opts?: { width?: number; height?: number },
): number {
  const w = opts?.width ?? SPACING.MUGSHOT_W;
  const h = opts?.height ?? SPACING.MUGSHOT_H;
  const capH = SPACING.MUGSHOT_CAP_H;

  // Top caption strip
  doc.setFillColor(...COLOR.BG_SECTION_HDR);
  doc.rect(x, y, w, capH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_MUGSHOT_LABEL);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text('ARREST PHOTO', x + w / 2, y + capH - 1.4, { align: 'center' });

  // Image area
  const imgY = y + capH;
  if (imgBase64) {
    try {
      doc.addImage(imgBase64, 'JPEG', x, imgY, w, h);
    } catch {
      // Fallback placeholder
      doc.setFillColor(230, 230, 235);
      doc.rect(x, imgY, w, h, 'F');
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6.5);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('[PHOTO UNAVAILABLE]', x + w / 2, imgY + h / 2, { align: 'center' });
    }
  } else {
    // Placeholder silhouette
    doc.setFillColor(235, 235, 240);
    doc.rect(x, imgY, w, h, 'F');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text('NO PHOTO', x + w / 2, imgY + h / 2, { align: 'center' });
  }

  // ORI watermark overlay (subtle, diagonal)
  if (meta.agencyOri && imgBase64) {
    // @ts-expect-error jsPDF GState
    doc.setGState(new doc.GState({ opacity: 0.12 }));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(
      sanitizePdfText(meta.agencyOri),
      x + w / 2,
      imgY + h / 2,
      { align: 'center', angle: -30 },
    );
    // @ts-expect-error jsPDF GState
    doc.setGState(new doc.GState({ opacity: 1.0 }));
  }

  // Outer frame
  doc.setDrawColor(...COLOR.MUGSHOT_RULE);
  doc.setLineWidth(BORDER.MUGSHOT_FRAME);
  doc.rect(x, y, w, capH + h);

  // Bottom metadata caption (arrest date / booking #)
  const botY = y + capH + h;
  const metaH = 6;
  doc.setFillColor(245, 245, 248);
  doc.rect(x, botY, w, metaH, 'F');
  doc.setDrawColor(...COLOR.MUGSHOT_RULE);
  doc.setLineWidth(BORDER.MUGSHOT_FRAME);
  doc.rect(x, botY, w, metaH);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_MUGSHOT_LABEL - 0.5);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text('ARRESTED', x + 1, botY + 1.8);
  doc.text('BOOKING', x + 1, botY + 4.6);

  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_MUGSHOT_LABEL + 0.3);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(sanitizePdfText(meta.arrestDate || '--'), x + w - 1, botY + 1.8, { align: 'right' });
  doc.text(sanitizePdfText(meta.bookingNumber || '--'), x + w - 1, botY + 4.6, { align: 'right' });

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return botY + metaH;
}

// ── Enhanced NIBRS Header (ORI tri-line + badge + inline barcode) ──

export interface EnhancedHeaderConfig {
  stateIdentifier?: string;
  agencyName: string;
  agencyOri?: string;
  fbiNumber?: string;
  ncicCode?: string;
  formTitle: string;
  formNumber?: string;
  formRevision?: string;
  caseNumber?: string;
  caseNumberLabel?: string;
  reportDate?: string;
  reportingOfficer?: string;
  reportingBadge?: string;
  reportingPost?: string;
  sealBase64?: string | null;
  logoBase64?: string | null;
  includeBarcodeInCaseBox?: boolean;
  distribution?: string[];  // ["PATROL", "RECORDS", "DA", "COURT"]
}

/**
 * Enhanced NIBRS-style header with tri-line agency identifier,
 * reporting officer badge/POST block, and optional Code 39 barcode under case number.
 * Returns Y after the header.
 */
export function drawEnhancedNibrsHeader(
  doc: jsPDF,
  config: EnhancedHeaderConfig,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = LAYOUT.PAGE_MARGIN;
  const contentW = pageW - 2 * margin;
  let y = LAYOUT.HEADER_TOP;

  const headerH = LAYOUT.HEADER_HEIGHT + 4; // taller to fit tri-line + officer block

  // ── Main dark header bar ─────────────
  doc.setFillColor(...COLOR.BG_SECTION_HDR);
  doc.rect(margin, y, contentW, headerH, 'F');

  // Seal image
  const sealSize = LAYOUT.SEAL_SIZE;
  if (config.sealBase64) {
    try {
      doc.addImage(config.sealBase64, 'PNG', margin + 3, y + 3, sealSize, sealSize);
    } catch { /* skip */ }
  }

  const textX = margin + (config.sealBase64 ? sealSize + 6 : 4);

  // State identifier (top-small)
  if (config.stateIdentifier) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_SUBHEADER);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(config.stateIdentifier.toUpperCase(), textX, y + 3.2);
  }

  // Agency name (large bold)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_HEADER_TITLE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text((config.agencyName || '').toUpperCase(), textX, y + 8);

  // Tri-line agency identifier (ORI | FBI | NCIC)
  const idParts: string[] = [];
  if (config.agencyOri) idParts.push(`ORI: ${config.agencyOri}`);
  if (config.fbiNumber) idParts.push(`FBI: ${config.fbiNumber}`);
  if (config.ncicCode) idParts.push(`NCIC: ${config.ncicCode}`);
  if (idParts.length) {
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_ORI_LINE);
    doc.setTextColor(255, 215, 0);  // gold identifier
    doc.text(idParts.join('  |  '), textX, y + 12);
  }

  // Form title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_REPORT_TYPE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text((config.formTitle || '').toUpperCase(), textX, y + headerH - 2.5);

  // ── Case number box (right) ──────────
  if (config.caseNumber) {
    const caseBoxW = LAYOUT.CASE_BOX_W;
    const caseBoxH = headerH - 4;
    const caseBoxX = margin + contentW - caseBoxW - 2;
    const caseBoxY = y + 2;

    doc.setDrawColor(...COLOR.TEXT_INVERTED);
    doc.setLineWidth(0.5);
    doc.rect(caseBoxX, caseBoxY, caseBoxW, caseBoxH);

    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_FORM_CELL_LABEL);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(
      config.caseNumberLabel || 'CASE NUMBER',
      caseBoxX + caseBoxW / 2,
      caseBoxY + 2.8,
      { align: 'center' },
    );

    // Value
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_CASE_NUMBER);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(
      sanitizePdfText(config.caseNumber),
      caseBoxX + caseBoxW / 2,
      caseBoxY + 6.5,
      { align: 'center' },
    );

    // Inline barcode (optional)
    if (config.includeBarcodeInCaseBox) {
      // Temporarily flip to white-bg barcode area
      const bcY = caseBoxY + caseBoxH - SPACING.BARCODE_INLINE_H - 0.8;
      doc.setFillColor(255, 255, 255);
      doc.rect(caseBoxX + 1, bcY - 0.2, caseBoxW - 2, SPACING.BARCODE_INLINE_H + 0.4, 'F');
      drawCode39Barcode(
        doc,
        config.caseNumber,
        caseBoxX + 2,
        bcY,
        caseBoxW - 4,
        SPACING.BARCODE_INLINE_H,
        { showText: false },
      );
    }

    // Reporting officer mini-block under case box
    if (config.reportingOfficer || config.reportingBadge) {
      const rY = caseBoxY + caseBoxH - 3;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT.SIZE_BADGE_LABEL);
      doc.setTextColor(200, 200, 200);
      const parts: string[] = [];
      if (config.reportingOfficer) parts.push(config.reportingOfficer);
      if (config.reportingBadge) parts.push(`#${config.reportingBadge}`);
      if (config.reportingPost) parts.push(`POST:${config.reportingPost}`);
      if (parts.length) {
        doc.text(
          sanitizePdfText(parts.join(' | ')),
          caseBoxX + caseBoxW / 2,
          rY,
          { align: 'center' },
        );
      }
    }
  }

  y += headerH;

  // ── Accent strip ─────────────────────
  doc.setFillColor(...COLOR.RULE_GOLD);
  doc.rect(margin, y, contentW, LAYOUT.ACCENT_STRIP_H, 'F');
  y += LAYOUT.ACCENT_STRIP_H;

  // ── Metadata strip (form# | revision | distribution | report date) ──
  if (config.formNumber || config.reportDate || config.distribution) {
    const metaH = 5;
    doc.setFillColor(245, 245, 248);
    doc.rect(margin, y, contentW, metaH, 'F');
    doc.setDrawColor(...COLOR.BORDER_SECTION);
    doc.setLineWidth(0.3);
    doc.rect(margin, y, contentW, metaH);

    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_SMALL_META);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);

    const mid = y + metaH - 1.8;
    let curX = margin + 2;
    if (config.formNumber) {
      doc.text(`FORM ${config.formNumber}`, curX, mid);
      curX += doc.getTextWidth(`FORM ${config.formNumber}`) + 4;
    }
    if (config.formRevision) {
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text(`REV ${config.formRevision}`, curX, mid);
      curX += doc.getTextWidth(`REV ${config.formRevision}`) + 4;
    }
    if (config.distribution && config.distribution.length) {
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text(`DIST: ${config.distribution.join(' / ')}`, curX, mid);
    }
    if (config.reportDate) {
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text(
        `REPORT DATE: ${sanitizePdfText(config.reportDate)}`,
        margin + contentW - 2,
        mid,
        { align: 'right' },
      );
    }
    y += metaH;
  }

  return y + 0.5;
}

// ── Narrative Helpers (Bates-ready paragraph numbering) ─────

export interface NarrativeRenderOptions {
  paragraphStart?: number;  // default 1
  lineHeight?: number;
  leftRule?: boolean;       // vertical pleading-style rule
  indent?: number;          // paragraph indent mm
}

/**
 * Render a court-ready numbered narrative paragraph.
 * Prepends a bold ¶N marker and optional left-margin rule.
 * Returns { newY, nextParagraph } so caller can chain.
 */
export function drawNumberedParagraph(
  doc: jsPDF,
  text: string,
  paragraphNum: number,
  x: number,
  y: number,
  w: number,
  opts?: { lineHeight?: number },
): number {
  if (!text) return y;
  const lineH = opts?.lineHeight ?? 3.5;
  const marker = `\u00B6${paragraphNum}`;

  // Paragraph marker (bold)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_PARA_MARKER);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  // Fallback to "P" since \u00B6 renders as "?" after sanitize (Latin-1 safe)
  doc.text(`P${paragraphNum}.`, x, y + lineH);

  // Body text (indented past marker)
  const markerW = 10;
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_NARRATIVE_PARA);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);

  const lines = wordWrapText(doc, sanitizePdfText(text), w - markerW);
  let curY = y + lineH;
  for (const line of lines) {
    doc.text(line, x + markerW, curY);
    curY += lineH;
  }

  return curY;
}

// ── Distribution Footer Block ───────────────────────────────

/**
 * Draw an expanded footer with distribution checkboxes + form info.
 * Optional replacement for basic footer. Returns nothing — modifies page in place.
 */
export function drawDistributionFooter(
  doc: jsPDF,
  data: {
    distribution?: string[];   // Items to render with checkboxes
    checked?: string[];        // Which ones are checked
    formNumber?: string;
    formRevision?: string;
    pageNum: number;
    totalPages: number;
    generatedAt?: string;
    batesSequence?: number;
    batesPrefix?: string;
  },
): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = LAYOUT.PAGE_MARGIN;
  const w = pageW - 2 * margin;
  const y = pageH - LAYOUT.FOOTER_HEIGHT - 8;

  // Gold rule above footer
  doc.setDrawColor(...COLOR.RULE_GOLD);
  doc.setLineWidth(BORDER.ACCENT_FOOTER);
  doc.line(margin, y, margin + w, y);

  const lineY = y + 3.2;

  // Left: distribution checkboxes
  const dist = data.distribution || ['PATROL', 'RECORDS', 'DETECTIVES', 'DA', 'COURT'];
  const checked = new Set((data.checked || []).map((s) => s.toUpperCase()));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FOOTER_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  let curX = margin + 1;
  doc.text('DIST:', curX, lineY);
  curX += doc.getTextWidth('DIST:') + 1.5;
  for (const d of dist) {
    // Tiny checkbox
    const cbSize = 1.8;
    doc.setDrawColor(...COLOR.TEXT_SECONDARY);
    doc.setLineWidth(0.25);
    doc.rect(curX, lineY - cbSize + 0.3, cbSize, cbSize);
    if (checked.has(d.toUpperCase())) {
      doc.setFillColor(...COLOR.TEXT_PRIMARY);
      doc.rect(curX + 0.3, lineY - cbSize + 0.6, cbSize - 0.6, cbSize - 0.6, 'F');
    }
    doc.setFont('helvetica', 'bold');
    doc.text(d, curX + cbSize + 0.8, lineY);
    curX += cbSize + 1 + doc.getTextWidth(d) + 3;
  }

  // Center: form info + page
  const centerParts: string[] = [];
  if (data.formNumber) centerParts.push(`FORM ${data.formNumber}`);
  if (data.formRevision) centerParts.push(`REV ${data.formRevision}`);
  centerParts.push(`PAGE ${data.pageNum} OF ${data.totalPages}`);
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_FOOTER_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(centerParts.join('  |  '), margin + w / 2, lineY + 3.5, { align: 'center' });

  // Right: Bates + timestamp
  if (data.batesSequence !== undefined) {
    drawBatesStamp(doc, data.batesSequence, {
      prefix: data.batesPrefix,
      yOffset: 0,
    });
  }
  if (data.generatedAt) {
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(FONT.SIZE_FOOTER_SECONDARY);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text(
      `GEN ${sanitizePdfText(data.generatedAt)}`,
      margin + w - 2,
      lineY + 3.5,
      { align: 'right' },
    );
  }

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
}

// ── Watermark Variants ──────────────────────────────────────

export type WatermarkVariant = 'DRAFT' | 'COPY' | 'SEALED' | 'VOIDED' | 'UNOFFICIAL' | 'CONFIDENTIAL';

const WATERMARK_STYLES: Record<WatermarkVariant, { color: RGBColor; opacity: number; angle: number; sub?: string }> = {
  DRAFT:        { color: [120, 120, 120], opacity: 0.08, angle: 45 },
  COPY:         { color: [70, 100, 140],  opacity: 0.07, angle: 45 },
  SEALED:       { color: [180, 20, 20],   opacity: 0.10, angle: 45, sub: 'BY ORDER OF COURT' },
  VOIDED:       { color: [180, 20, 20],   opacity: 0.18, angle: -20 },
  UNOFFICIAL:   { color: [150, 80, 20],   opacity: 0.08, angle: 45 },
  CONFIDENTIAL: { color: [80, 80, 80],    opacity: 0.07, angle: 45 },
};

/**
 * Apply a diagonal watermark variant to the current page.
 */
export function drawWatermarkVariant(
  doc: jsPDF,
  variant: WatermarkVariant,
): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const style = WATERMARK_STYLES[variant];
  if (!style) return;

  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: style.opacity }));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_WATERMARK_LARGE);
  doc.setTextColor(...style.color);

  doc.text(
    variant,
    pageW / 2,
    pageH / 2,
    { align: 'center', angle: style.angle },
  );

  if (style.sub) {
    doc.setFontSize(FONT.SIZE_WATERMARK_SMALL);
    doc.text(
      style.sub,
      pageW / 2,
      pageH / 2 + 14,
      { align: 'center', angle: style.angle },
    );
  }

  // VOIDED adds strikethrough bar
  if (variant === 'VOIDED') {
    doc.setFillColor(...style.color);
    // @ts-expect-error jsPDF GState
    doc.setGState(new doc.GState({ opacity: 0.25 }));
    // Approximate diagonal band
    doc.setLineWidth(18);
    doc.setDrawColor(...style.color);
    doc.line(20, pageH - 20, pageW - 20, 20);
  }

  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));
}

/** Apply watermark variant to every page of the finalized doc. */
export function applyWatermarkToAllPages(
  doc: jsPDF,
  variant: WatermarkVariant,
): void {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawWatermarkVariant(doc, variant);
  }
}

// ── Auto-Barcode Corner Stamp ───────────────────────────────
// Compact Code 39 barcode + identifier rendered in the bottom-right
// corner of every page. Designed to be applied automatically by the
// finalize step without overlapping any existing header/footer content.

/**
 * Render a compact barcode block in the bottom-right corner of the current page.
 * Block layout: 48mm × 11mm total
 *   - Top 6mm: Code 39 bars (no human-readable line inside bars)
 *   - Bottom 4mm: "*VALUE*" label in monospace, right-aligned
 * Positioned in the 10mm page margin (above footer text) so it never
 * collides with content.
 */
export function drawBarcodeCornerStamp(
  doc: jsPDF,
  value: string,
  opts?: {
    width?: number;
    height?: number;
    marginOffsetY?: number;  // shift up from bottom (to stack above Bates)
  },
): void {
  if (!value) return;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = LAYOUT.PAGE_MARGIN;

  const w = opts?.width ?? 48;
  const h = opts?.height ?? 11;
  const stackOffset = opts?.marginOffsetY ?? 0;

  // Anchor: bottom-right, above footer text area
  const x = pageW - margin - w;
  const y = pageH - margin - h - stackOffset;

  // Light background + subtle border (scanner-friendly high contrast)
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, w, h, 'F');
  doc.setDrawColor(...COLOR.BARCODE_STRIP_RULE);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h);

  // Barcode bars (top portion, inset 1mm)
  const barH = h - 4.2;
  drawCode39Barcode(
    doc,
    value,
    x + 1,
    y + 0.5,
    w - 2,
    barH,
    { showText: false },
  );

  // Human-readable identifier below barcode
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_BARCODE_LABEL + 0.5);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  const label = sanitizePdfText(`*${value.toUpperCase()}*`);
  doc.text(label, x + w / 2, y + h - 1.1, { align: 'center' });

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
}

/**
 * Apply the corner barcode stamp to every page of the finalized doc.
 * Automatically stacks above the Bates stamp if both are present.
 */
export function applyBarcodeToAllPages(
  doc: jsPDF,
  value: string,
  opts?: { stackAboveBates?: boolean; width?: number; height?: number },
): void {
  if (!value) return;
  const total = doc.getNumberOfPages();
  // If stacking above Bates, offset barcode upward by Bates height + gap
  const stackOffset = opts?.stackAboveBates ? 6 : 0;
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawBarcodeCornerStamp(doc, value, {
      width: opts?.width,
      height: opts?.height,
      marginOffsetY: stackOffset,
    });
  }
}

// ── PDF417 (2D Stacked Barcode) ─────────────────────────────
// Used on driver's licenses and ID cards. Encodes far more data than
// Code 39 and is scannable by standard police barcode scanners.

/**
 * AAMVA-style person identifier payload.
 * Matches the subfile tags used on US driver's license PDF417 barcodes,
 * so scanners that decode DLs will also decode these.
 */
export interface PersonIdPayload {
  lastName?: string;    // DAA / DCS
  firstName?: string;   // DAC / DAE
  middleName?: string;  // DAD
  dob?: string;         // DBB  — MMDDYYYY
  sex?: string;         // DBC  — 1=M, 2=F, 9=U
  address?: string;     // DAG
  city?: string;        // DAI
  state?: string;       // DAJ
  zip?: string;         // DAK
  dlNumber?: string;    // DAQ
  dlClass?: string;     // DCA
  height?: string;      // DAU  — "070 in"
  weight?: string;      // DAW
  eyeColor?: string;    // DAY  — BLK, BLU, BRO, etc.
  hairColor?: string;   // DAZ
  race?: string;        // DCL
  recordId?: string;    // (custom) our internal record id
  agencyOri?: string;   // (custom) RMPG agency ORI
}

/**
 * Encode a PersonIdPayload as an AAMVA-compatible subfile block.
 * Format: one tag per line — "DAA{value}", "DAG{value}", etc.
 * Scanners treat unknown tags as opaque so adding custom ones is safe.
 */
export function encodePersonIdPayload(payload: PersonIdPayload): string {
  const fields: string[] = [];
  const push = (tag: string, val: string | undefined) => {
    if (!val) return;
    fields.push(`${tag}${sanitizePdfText(String(val))}`);
  };
  // AAMVA v2020 tags
  push('DCS', payload.lastName);
  push('DAC', payload.firstName);
  push('DAD', payload.middleName);
  push('DBB', payload.dob);
  push('DBC', payload.sex);
  push('DAG', payload.address);
  push('DAI', payload.city);
  push('DAJ', payload.state);
  push('DAK', payload.zip);
  push('DAQ', payload.dlNumber);
  push('DCA', payload.dlClass);
  push('DAU', payload.height);
  push('DAW', payload.weight);
  push('DAY', payload.eyeColor);
  push('DAZ', payload.hairColor);
  push('DCL', payload.race);
  // Custom RMPG extension tags
  push('ZRI', payload.recordId);
  push('ZOR', payload.agencyOri);
  return fields.join('\n');
}

/**
 * Generate a PDF417 barcode data URL via bwip-js.
 * Returns a PNG data URL, or empty string on failure.
 */
function renderPdf417DataUrl(value: string): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  try {
    // bwip-js's typed RenderOptions doesn't enumerate every barcode-specific
    // option (eclevel, rows, columns are PDF417-only). Cast to any to pass
    // them through — the library validates them at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bwipjs.toCanvas(canvas, {
      bcid: 'pdf417',
      text: value,
      scaleX: 3,
      scaleY: 3,
      eclevel: 2,
      padding: 2,
      includetext: false,
      backgroundcolor: 'FFFFFF',
      barcolor: '000000',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

/**
 * Draw a PDF417 barcode at (x,y) with the given mm dimensions.
 * Returns true if the barcode was embedded; false if bwip-js failed.
 */
export function drawPdf417Barcode(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts?: { caption?: string },
): boolean {
  if (!value) return false;
  const dataUrl = renderPdf417DataUrl(value);
  if (!dataUrl) return false;

  // Background + border
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, w, h, 'F');
  doc.setDrawColor(...COLOR.BARCODE_STRIP_RULE);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h);

  // Image inset slightly so borders don't clip the quiet zone
  const inset = 0.6;
  try {
    doc.addImage(dataUrl, 'PNG', x + inset, y + inset, w - 2 * inset, h - 2 * inset - (opts?.caption ? 2.6 : 0));
  } catch {
    return false;
  }

  if (opts?.caption) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_BARCODE_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(
      sanitizePdfText(opts.caption),
      x + w / 2,
      y + h - 0.8,
      { align: 'center' },
    );
  }

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return true;
}

/**
 * Draw a PDF417 corner stamp in the bottom-right of the current page.
 * Wider and taller than the Code 39 corner stamp (since 2D barcodes
 * need more area for their data density).
 */
export function drawPdf417CornerStamp(
  doc: jsPDF,
  value: string,
  opts?: { width?: number; height?: number; marginOffsetY?: number; caption?: string },
): void {
  if (!value) return;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = LAYOUT.PAGE_MARGIN;

  const w = opts?.width ?? 60;
  const h = opts?.height ?? 18;
  const stackOffset = opts?.marginOffsetY ?? 0;
  const x = pageW - margin - w;
  const y = pageH - margin - h - stackOffset;

  drawPdf417Barcode(doc, value, x, y, w, h, { caption: opts?.caption });
}

/** Apply PDF417 corner stamp to every page. */
export function applyPdf417ToAllPages(
  doc: jsPDF,
  value: string,
  opts?: { width?: number; height?: number; stackAboveBates?: boolean; caption?: string },
): void {
  if (!value) return;
  const total = doc.getNumberOfPages();
  const stackOffset = opts?.stackAboveBates ? 6 : 0;
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawPdf417CornerStamp(doc, value, {
      width: opts?.width,
      height: opts?.height,
      marginOffsetY: stackOffset,
      caption: opts?.caption,
    });
  }
}

// ── PDF417 Side Barcode (vertical, right-margin) ────────────
// Rich-data vertical barcode positioned in the right page margin of every
// page. Same position per page for consistent scan placement. Payload
// contains full form metadata so scanning gives complete context.

/** Form-level metadata encoded into every page's side barcode. */
export interface FormMetadataPayload {
  form?: string;       // e.g. "INCIDENT", "BOLO", "PERSON", "CITATION"
  formNumber?: string; // e.g. "RMPG-101"
  caseNumber?: string; // case/incident/record identifier
  agency?: string;     // agency short name (e.g. "RMPG")
  agencyOri?: string;  // agency ORI (e.g. "UT0180100")
  reportDate?: string; // e.g. "2026-04-17"
  officer?: string;    // reporting officer name
  badge?: string;      // reporting officer badge #
  page?: number;       // current page number (added per-page by renderer)
  totalPages?: number; // total page count
  priority?: string;   // incident priority label
  status?: string;     // record status
}

/**
 * Encode form metadata as a pipe-delimited KEY:VALUE string suitable for
 * embedding in a PDF417 barcode. Decodes cleanly in any scanner that
 * reads PDF417 (no agency-specific decoder required).
 */
export function encodeFormMetadata(p: FormMetadataPayload): string {
  const parts: string[] = [];
  const push = (k: string, v: string | number | undefined) => {
    if (v == null || v === '') return;
    const s = sanitizePdfText(String(v)).replace(/\|/g, '/');
    parts.push(`${k}:${s}`);
  };
  push('FORM', p.form);
  push('FNO',  p.formNumber);
  push('CASE', p.caseNumber);
  push('AG',   p.agency);
  push('ORI',  p.agencyOri);
  push('DT',   p.reportDate);
  push('OFC',  p.officer);
  push('BADGE',p.badge);
  push('PG',   p.page);
  push('OF',   p.totalPages);
  push('PRIO', p.priority);
  push('STAT', p.status);
  return parts.join('|');
}

/**
 * Render a horizontal PDF417 barcode in the bottom strip of the page,
 * sitting ABOVE the footer text (e.g. "FORM UIR-205 | INTERNAL USE ONLY").
 * Same position on every page — consistent scan placement like a
 * driver's license or shipping label.
 *
 * Default dimensions: 45mm wide × 8mm tall. Anchored inside the page's
 * bottom safe-print zone so nothing is cropped by standard office printers.
 *
 * The `side` option chooses bottom-left or bottom-right placement. The
 * opposing footer text slot (form# vs "Page X of Y") stays untouched.
 */
export function drawPdf417SideBarcode(
  doc: jsPDF,
  value: string,
  opts?: {
    width?: number;   // horizontal width (mm) — default 45
    height?: number;  // vertical height (mm) — default 8
    side?: 'right' | 'left';  // bottom-left (default) or bottom-right
    caption?: string; // small label rendered ABOVE the barcode
  },
): boolean {
  if (!value) return false;
  if (typeof document === 'undefined') return false;

  const w = opts?.width ?? 45;
  const h = opts?.height ?? 8;
  // Default to bottom-LEFT, positioned directly above the form# slot in
  // the footer ("FORM UIR-205 | INTERNAL USE ONLY"). Explicit 'right' or
  // 'center' values anchor accordingly.
  const side = opts?.side ?? 'left';

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Render horizontal PDF417 to off-screen canvas (no rotation this time).
  const canvas = document.createElement('canvas');
  try {
    bwipjs.toCanvas(canvas, {
      bcid: 'pdf417',
      text: value,
      scaleX: 3,
      scaleY: 3,
      eclevel: 2,
      padding: 2,
      includetext: false,
      backgroundcolor: 'FFFFFF',
      barcolor: '000000',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  } catch {
    return false;
  }
  const dataUrl = canvas.toDataURL('image/png');

  // Bottom-strip placement. Vertical layout top-to-bottom:
  //   pageH - 20 .... barcode top (8mm tall)
  //   pageH - 12 .... barcode bottom
  //   pageH - 8  .... footer text baseline
  //   pageH - 5  .... safe print zone
  //   pageH      .... page edge
  //
  // Horizontally CENTERED by default — sits between the footer's form#
  // (left) and page-number (right) slots without colliding with either.
  // 12mm of clearance below the barcode, 8mm from bottom page edge.
  const SAFE_PRINT_EDGE_SIDE = 8;
  let x: number;
  if (side === 'right') {
    x = pageW - SAFE_PRINT_EDGE_SIDE - w;
  } else if (side === 'left') {
    x = SAFE_PRINT_EDGE_SIDE;
  } else {
    x = (pageW - w) / 2;  // centered (default)
  }
  const y = pageH - 20;

  try {
    doc.addImage(dataUrl, 'PNG', x, y, w, h);
  } catch {
    return false;
  }

  // Small caption ABOVE the barcode if provided (1.5mm gap). Aligned to
  // match the barcode's horizontal placement — centered/left/right.
  if (opts?.caption) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_BARCODE_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    const capY = y - 1.5;
    if (side === 'right') {
      doc.text(sanitizePdfText(opts.caption), x + w, capY, { align: 'right' });
    } else if (side === 'left') {
      doc.text(sanitizePdfText(opts.caption), x, capY, { align: 'left' });
    } else {
      doc.text(sanitizePdfText(opts.caption), x + w / 2, capY, { align: 'center' });
    }
  }

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return true;
}

/**
 * Apply a vertical PDF417 side barcode to every page of the finalized doc.
 * The payload factory receives (pageNum, totalPages) and returns the text
 * to encode — callers can embed per-page data like "PG:3".
 */
export function applyPdf417SideToAllPages(
  doc: jsPDF,
  payloadFactory: string | ((pageNum: number, totalPages: number) => string),
  opts?: {
    width?: number;
    height?: number;
    side?: 'right' | 'left';
    caption?: string | ((pageNum: number, totalPages: number) => string);
  },
): void {
  const total = doc.getNumberOfPages();
  if (total < 1) return;
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const value = typeof payloadFactory === 'function'
      ? payloadFactory(p, total)
      : payloadFactory;
    if (!value) continue;
    const caption = typeof opts?.caption === 'function'
      ? opts.caption(p, total)
      : opts?.caption;
    drawPdf417SideBarcode(doc, value, {
      width: opts?.width,
      height: opts?.height,
      side: opts?.side,
      caption,
    });
  }
}
