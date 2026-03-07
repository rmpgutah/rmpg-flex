// ============================================================
// RMPG Flex — NIBRS/UCR Grid-Based Form Helpers
// Dense grid cells with inline labels, sidebar section tabs,
// compact checkbox grids, and embedded code reference tables
// Designed to replicate official law enforcement form formats
// ============================================================

import jsPDF from 'jspdf';
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
export function drawFormCell(
  doc: jsPDF,
  cell: FormCell,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const pad = SPACING.FORM_CELL_PAD;

  // Cell border
  doc.setDrawColor(...COLOR.BORDER_FORM_GRID);
  doc.setLineWidth(BORDER.FORM_CELL);
  doc.rect(x, y, w, h);

  // Label (tiny, Helvetica, gray — inside cell top-left)
  if (cell.label) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_FORM_CELL_LABEL);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text(cell.label.toUpperCase(), x + pad, y + pad + 1.5);
  }

  // Value (Courier, black — below label)
  if (cell.checkbox) {
    // Render checkbox square
    const cbSize = 2.8;
    const cbX = x + pad;
    const cbY = y + SPACING.FORM_CELL_LABEL_H + pad + 0.5;
    doc.setDrawColor(...COLOR.BORDER_FORM_GRID);
    doc.setLineWidth(BORDER.CHECKBOX);
    doc.rect(cbX, cbY, cbSize, cbSize);
    if (cell.checked) {
      doc.setLineWidth(BORDER.CHECK_MARK);
      doc.line(cbX + 0.5, cbY + 1.4, cbX + 1.1, cbY + 2.3);
      doc.line(cbX + 1.1, cbY + 2.3, cbX + 2.3, cbY + 0.5);
    }
    // Label text after checkbox
    if (cell.value) {
      doc.setFont('courier', 'normal');
      doc.setFontSize(cell.valueFontSize || FONT.SIZE_FORM_CELL_VALUE);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text(cell.value, cbX + cbSize + 1, cbY + cbSize - 0.3);
    }
  } else if (cell.value) {
    doc.setFont('courier', cell.valueBold ? 'bold' : 'normal');
    doc.setFontSize(cell.valueFontSize || FONT.SIZE_FORM_CELL_VALUE);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);

    // Center value vertically between label bottom and cell bottom
    const labelBottom = SPACING.FORM_CELL_LABEL_H + pad + 1;
    const valueY = y + labelBottom + (h - labelBottom) / 2 + 0.8;
    const maxW = w - 2 * pad;

    if (cell.align === 'center') {
      doc.text(cell.value, x + w / 2, valueY, { align: 'center', maxWidth: maxW });
    } else if (cell.align === 'right') {
      doc.text(cell.value, x + w - pad, valueY, { align: 'right', maxWidth: maxW });
    } else {
      doc.text(cell.value, x + pad, valueY, { maxWidth: maxW });
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
  const h = rowH || SPACING.FORM_CELL_H;
  const totalRatio = cells.reduce((sum, c) => sum + (c.ratio || 1), 0);
  let cellX = x;

  for (const cell of cells) {
    const ratio = cell.ratio || 1;
    const cellW = (ratio / totalRatio) * totalW;
    drawFormCell(doc, cell, cellX, y, cellW, h);
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

  // Bold outer border around entire grid
  if (opts?.outerBorder !== false) {
    doc.setDrawColor(...COLOR.BORDER_FORM_GRID);
    doc.setLineWidth(BORDER.FORM_GRID_OUTER);
    doc.rect(x, startY, totalW, curY - startY);
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
  const upperLabel = label.toUpperCase();
  const maxTextLen = height - 4;
  let fontSize: number = FONT.SIZE_SIDEBAR_TAB;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  let textW = doc.getTextWidth(upperLabel);

  // Scale down if text overflows available height
  if (textW > maxTextLen && maxTextLen > 0) {
    fontSize = fontSize * (maxTextLen / textW);
    fontSize = Math.max(fontSize, 4);
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
  const cbSize = 2.2;
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

    // Label text
    const labelText = items[i].code
      ? `${items[i].code} = ${items[i].label}`
      : items[i].label;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_FORM_CELL_LABEL);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(labelText, cbX + cbSize + 0.8, cbY + cbSize - 0.2, {
      maxWidth: cellW - cbSize - 2.5,
    });
  }

  // Account for last row
  curY += rowH;

  // Outer border around checkbox grid
  doc.setDrawColor(...COLOR.BORDER_FORM_GRID);
  doc.setLineWidth(BORDER.FORM_CELL);
  doc.rect(x, y, totalW, curY - y);

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
  const colW = totalW / cols;
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
    doc.text(codes[i].code, cellX + 1, curY + 2.3);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(4);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(`= ${codes[i].description}`, cellX + 5.5, curY + 2.3, {
      maxWidth: colW - 7,
    });
  }

  curY += rowH;

  // Outer border
  doc.setDrawColor(...COLOR.BORDER_FORM_GRID);
  doc.setLineWidth(BORDER.FORM_CELL);
  doc.rect(x, y, totalW, curY - y);

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
  },
): number {
  const pageH = doc.internal.pageSize.getHeight();
  const bottomMargin = LAYOUT.PAGE_MARGIN + LAYOUT.FOOTER_HEIGHT + 2;
  const gridX = getGridStartX();
  const gridW = getGridContentWidth(doc);

  // Calculate total section height
  let totalH = 0;
  for (const row of config.rows) {
    totalH += row.height || SPACING.FORM_CELL_H;
  }

  // Check if section fits on current page
  let curY = config.y;
  if (curY + totalH > pageH - bottomMargin) {
    doc.addPage();
    curY = LAYOUT.PAGE_MARGIN + LAYOUT.HEADER_HEIGHT + LAYOUT.ACCENT_STRIP_H + 2;
  }

  const sectionStartY = curY;

  // Draw grid rows
  curY = drawFormGrid(doc, config.rows, gridX, curY, gridW);

  // Draw additional content if provided
  if (config.afterGrid) {
    curY = config.afterGrid(curY);
  }

  // Draw sidebar tab spanning the full section height
  const sectionH = curY - sectionStartY;
  drawSideTab(
    doc,
    config.sideTab.label,
    sectionStartY,
    sectionH,
    config.sideTab.color,
  );

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

  // Agency name (centered in header bar)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_HEADER_TITLE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text(config.agencyName.toUpperCase(), pageW / 2, y + 8, { align: 'center' });

  // State identifier (small, above agency name if present)
  if (config.stateIdentifier) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_SUBHEADER);
    doc.text(config.stateIdentifier.toUpperCase(), pageW / 2, y + 4, { align: 'center' });
  }

  // Form title (below agency name)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_REPORT_TYPE);
  doc.text(config.formTitle.toUpperCase(), pageW / 2, y + 13, { align: 'center' });

  // Case number box (right side)
  if (config.caseNumber) {
    const caseBoxW = LAYOUT.CASE_BOX_W;
    const caseBoxH = 12;
    const caseBoxX = margin + contentW - caseBoxW - 2;
    const caseBoxY = y + 4;

    // White box with border
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...COLOR.TEXT_INVERTED);
    doc.setLineWidth(BORDER.CASE_BOX);
    doc.rect(caseBoxX, caseBoxY, caseBoxW, caseBoxH, 'FD');

    // "CASE NUMBER" label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_FORM_CELL_LABEL);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text('CASE NUMBER', caseBoxX + caseBoxW / 2, caseBoxY + 3, { align: 'center' });

    // Case number value
    doc.setFont('courier', 'bold');
    doc.setFontSize(FONT.SIZE_CASE_NUMBER);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(config.caseNumber, caseBoxX + caseBoxW / 2, caseBoxY + 9, { align: 'center' });
  }

  y += LAYOUT.HEADER_HEIGHT;

  // Accent strip below header
  doc.setFillColor(...COLOR.BG_TABLE_HDR);
  doc.rect(margin, y, contentW, LAYOUT.ACCENT_STRIP_H, 'F');
  y += LAYOUT.ACCENT_STRIP_H;

  // Sub-header row: Form number (left) + Report date (right)
  y += 1;
  if (config.formNumber || config.reportDate) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_SMALL_META);
    doc.setTextColor(...COLOR.TEXT_MUTED);
    if (config.formNumber) {
      doc.text(config.formNumber, margin + 2, y + 3);
    }
    if (config.reportDate) {
      doc.text(`REPORT DATE: ${config.reportDate}`, margin + contentW - 2, y + 3, { align: 'right' });
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
