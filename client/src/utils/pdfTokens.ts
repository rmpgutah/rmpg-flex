// ============================================================
// RMPG Flex — PDF Design Token System
// Blocky police-report style: Courier values, Helvetica labels
// Thick borders, dark section headers, tight structured grid
// ============================================================

import jsPDF from 'jspdf';

// ── Color Tokens (RGB tuples) ────────────────────────────────

export type RGBColor = readonly [number, number, number];

export const COLOR = {
  // Text hierarchy
  TEXT_PRIMARY:    [0, 0, 0]        as const,  // Courier field values
  TEXT_SECONDARY:  [50, 50, 50]     as const,  // Helvetica labels (darker)
  TEXT_TERTIARY:   [100, 100, 100]  as const,  // Placeholders, sub-labels
  TEXT_INVERTED:   [255, 255, 255]  as const,  // White on dark backgrounds
  TEXT_MUTED:      [140, 140, 140]  as const,  // Form number, report date

  // Borders — thicker, more structured for blocky look
  BORDER_FIELD:    [120, 120, 120]  as const,  // Field box borders (darker)
  BORDER_TABLE:    [150, 150, 155]  as const,  // Row separator lines
  BORDER_COLUMN:   [140, 140, 145]  as const,  // Vertical column separators
  BORDER_OUTER:    [40, 40, 40]     as const,  // Table outer border (near-black)
  BORDER_SECTION:  [30, 30, 30]     as const,  // Section outline (bold)

  // Backgrounds
  BG_ZEBRA:        [235, 235, 240]  as const,  // Even-row table shading
  BG_SECTION_HDR:  [25, 25, 30]     as const,  // Section header bar (DARK — police style)
  BG_TABLE_HDR:    [50, 50, 60]     as const,  // Table column header (dark)

  // Financial
  AMOUNT_CREDIT:   [0, 120, 60]     as const,
  AMOUNT_DEBIT:    [180, 0, 0]      as const,

  // Watermark
  WATERMARK:       [120, 120, 120]  as const,

  // NIBRS Grid Form — sidebar tabs + dense cells
  BG_SIDEBAR_TAB:      [25, 25, 30]     as const,  // Dark sidebar tab background
  BG_FORM_CELL_LABEL:  [240, 240, 245]  as const,  // Light gray label strip inside cell
  BORDER_FORM_GRID:    [60, 60, 60]     as const,  // Dark grid lines (shared borders)
} as const;

// ── Typography Tokens ────────────────────────────────────────
// Values: Courier (typewriter police-report look)
// Labels: Helvetica (clean, small-caps feel)

export const FONT = {
  SIZE_HEADER_TITLE:      13,    // Agency name in header bar
  SIZE_SECTION_TITLE:     8,     // Section header bar text (all-caps)
  SIZE_FIELD_VALUE:       8.5,   // Courier values inside field boxes
  SIZE_FIELD_LABEL:       6,     // Helvetica labels above field boxes
  SIZE_TABLE_HEADER:      6.5,   // Helvetica column headers
  SIZE_TABLE_BODY:        7.5,   // Courier table row content
  SIZE_FOOTER_PRIMARY:    5,     // Footer form #, page #
  SIZE_FOOTER_SECONDARY:  4.5,   // Footer secondary info
  SIZE_SMALL_META:        5,     // Form revision, report date
  SIZE_CHECKBOX_LABEL:    6.5,   // Checkbox labels
  SIZE_BANNER:            14,    // Large notice banners
  SIZE_BANNER_SMALL:      8,     // Mandatory report banner
  SIZE_WATERMARK_LARGE:   72,    // "CONFIDENTIAL"
  SIZE_WATERMARK_SMALL:   24,    // Agency name under watermark
  SIZE_SIGNATURE_X:       8,     // "X" marker on signature line
  SIZE_SIGNATURE_LABEL:   5,     // "SIGNATURE", "PRINTED NAME"
  SIZE_BALANCE_DUE:       11,    // Invoice balance due
  SIZE_TOTAL_LABEL:       10,    // Invoice "TOTAL:" label
  SIZE_CLASSIF_BAR:       7,     // Classification/priority bar (kept for compat)
  SIZE_SUBHEADER:         6.5,   // Subheader text in report header
  SIZE_REPORT_TYPE:       7,     // Report type label in header
  SIZE_CASE_NUMBER:       9,     // Case number value (courier bold)

  // NIBRS Grid Form — cell typography
  SIZE_FORM_CELL_LABEL:   5,     // Tiny label inside cell top-left
  SIZE_FORM_CELL_VALUE:   8,     // Courier value below label in cell
  SIZE_SIDEBAR_TAB:       7,     // Rotated sidebar tab label
} as const;

// ── Border / Line Width Tokens ───────────────────────────────

export const BORDER = {
  SECTION_OUTER:    0.8,   // Bold border around sections (blocky)
  FIELD:            0.3,   // Field box borders (visible grid)
  TABLE_OUTER:      0.8,   // Outer border of tables (bold)
  TABLE_ROW:        0.15,  // Row separators (subtle)
  TABLE_COLUMN:     0.15,  // Column separators (subtle)
  CHECKBOX:         0.35,  // Checkbox square border
  CHECK_MARK:       0.7,   // Check mark stroke
  SIGNATURE_LINE:   0.5,   // Signature line
  ACCENT_HEADER:    0.8,   // Accent line below header
  ACCENT_FOOTER:    0.5,   // Accent line above footer
  CASE_BOX:         1.2,   // White border inside case number box
  BANNER:           1.0,   // Bold banner borders
  DIAGRAM_GRID:     0.1,   // Accident diagram grid lines

  // NIBRS Grid Form — border widths
  FORM_GRID_OUTER:  0.6,   // Bold outer border around grid sections
  FORM_CELL:        0.25,  // Inner cell borders (shared)
  SIDEBAR_TAB:      0.5,   // Sidebar tab border
} as const;

// ── Spacing Tokens (tighter throughout) ──────────────────────

export const SPACING = {
  XS:                 0.3,   // 0.3mm — micro padding (tighter)
  SM:                 1,     // 1mm — small gap (tighter)
  MD:                 2,     // 2mm — base unit (tighter)
  LG:                 3.5,   // 3.5mm — line height (tighter)
  XL:                 4,     // 4mm — generous gap (tighter)

  CONTENT_INSET:      2,     // Left/right padding inside sections (tighter)
  SECTION_HEADER_H:   5.5,   // Section header bar height (tighter)
  SECTION_GAP:        1.5,   // Gap between sections (tighter)
  SECTION_CONTENT_PAD: 1.5,  // Gap from header bar to first content (tighter)
  SECTION_BOTTOM_PAD:  2,    // Padding inside section before bottom border (tighter)

  FIELD_ROW_HEIGHT:   9,     // Height of field box (tighter)
  FIELD_ROW_ADVANCE:  9.5,   // Y-advance after field row (tighter)

  SIGNATURE_BOX_H:    30,    // Signature block total height (tighter)
  SIGNATURE_ROLE_H:   5,     // Role label header bar height (tighter)
  SIGNATURE_SUB_GAP:  5.5,   // Gap between sig line and sub-fields (tighter)

  // NIBRS Grid Form — cell dimensions
  FORM_CELL_H:        7,     // Default form cell height
  FORM_CELL_LABEL_H:  2.5,   // Height reserved for label strip inside cell
  FORM_CELL_PAD:      1.2,   // Padding inside cell for label/value text
  SIDEBAR_TAB_W:      12,    // Width of sidebar section tab
} as const;

// ── Layout Tokens ────────────────────────────────────────────

export const LAYOUT = {
  PAGE_MARGIN:       10,     // Tighter margins for max content area
  HEADER_HEIGHT:     20,     // More compact header bar
  FOOTER_HEIGHT:     6,      // Slimmer footer
  HEADER_TOP:        5,      // Y-start of header bar (closer to top)
  CLASSIF_BAR_H:     5,      // Classification bar height (compact)
  SEAL_SIZE:         14,     // Compact logo
  ACCENT_STRIP_H:    1,     // Thinner accent strip below header
  CASE_BOX_W:        42,     // Case number box width
  LINE_HEIGHT:       3.5,    // Base line height for wrapped text (tighter)
  DIAGRAM_GRID_STEP: 10,     // Grid spacing in accident diagram

  // NIBRS Grid Form — layout
  SIDEBAR_TAB_W:     12,     // Sidebar tab width (matches SPACING)
} as const;

// ── Computed Layout Helpers ──────────────────────────────────

/** Page content width = pageWidth - 2 * PAGE_MARGIN */
export function getContentWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth() - 2 * LAYOUT.PAGE_MARGIN;
}

/** Half-column width for 2-column layouts (with 3mm gap) */
export function getHalfWidth(doc: jsPDF): number {
  return (getContentWidth(doc) - 3) / 2;
}

/** Full-width field = contentWidth minus left/right inset */
export function getFullFieldWidth(doc: jsPDF): number {
  return getContentWidth(doc) - 2 * SPACING.CONTENT_INSET;
}

/** X-position of left column content start */
export function getLeftX(): number {
  return LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET;
}

/** X-position of right column in a 2-column layout */
export function getRightColumnX(doc: jsPDF): number {
  return LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET + getHalfWidth(doc) + SPACING.SM;
}

/** Column width for half-width fields (accounting for gap) */
export function getHalfFieldWidth(doc: jsPDF): number {
  return getHalfWidth(doc) - SPACING.SM;
}

/** One-third width for 3-column layouts */
export function getThirdWidth(doc: jsPDF): number {
  return (getContentWidth(doc) - 2 * SPACING.CONTENT_INSET) / 3;
}

/** One-quarter width for 4-column layouts (with 2mm gaps) */
export function getQuarterWidth(doc: jsPDF): number {
  return (getContentWidth(doc) - 2 * SPACING.CONTENT_INSET - 3 * SPACING.MD) / 4;
}

/** Generate proportional column X positions from ratio array */
export function getProportionalColumns(doc: jsPDF, ratios: number[]): number[] {
  const totalRatio = ratios.reduce((a, b) => a + b, 0);
  const availW = getContentWidth(doc) - 2 * SPACING.CONTENT_INSET;
  let x = getLeftX();
  const positions: number[] = [];
  for (const r of ratios) {
    positions.push(x);
    x += (r / totalRatio) * availW;
  }
  return positions;
}

// ── NIBRS Grid Layout Helpers ─────────────────────────────────

/** X-position where grid content starts (after sidebar tab) */
export function getGridStartX(): number {
  return LAYOUT.PAGE_MARGIN + LAYOUT.SIDEBAR_TAB_W;
}

/** Available width for grid cells (page minus margins minus sidebar tab) */
export function getGridContentWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth() - 2 * LAYOUT.PAGE_MARGIN - LAYOUT.SIDEBAR_TAB_W;
}
