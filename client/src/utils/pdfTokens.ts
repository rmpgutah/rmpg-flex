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
  TEXT_SECONDARY:  [74, 85, 104]    as const,  // Helvetica labels (#4a5568)
  TEXT_TERTIARY:   [100, 100, 100]  as const,  // Placeholders, sub-labels
  TEXT_INVERTED:   [255, 255, 255]  as const,  // White on dark backgrounds
  TEXT_MUTED:      [140, 140, 140]  as const,  // Form number, report date

  // Borders — clean, professional lines
  BORDER_FIELD:    [113, 128, 150]  as const,  // Field box borders (#718096)
  BORDER_TABLE:    [180, 180, 185]  as const,  // Row separator lines
  BORDER_COLUMN:   [170, 170, 175]  as const,  // Vertical column separators
  BORDER_OUTER:    [80, 80, 85]     as const,  // Table outer border
  BORDER_SECTION:  [100, 100, 105]  as const,  // Section outline

  // Backgrounds — lighter, modern government-form style
  BG_ZEBRA:        [242, 242, 246]  as const,  // Even-row table shading
  BG_SECTION_HDR:  [45, 55, 72]     as const,  // Section header bar (#2d3748 dark blue-gray)
  BG_TABLE_HDR:    [70, 75, 88]     as const,  // Table column header (slate)

  // Financial
  AMOUNT_CREDIT:   [0, 120, 60]     as const,
  AMOUNT_DEBIT:    [180, 0, 0]      as const,

  // Watermark
  WATERMARK:       [120, 120, 120]  as const,

  // Caution / Warning
  CAUTION_BG:      [255, 248, 230]  as const,  // Amber background
  CAUTION_ACCENT:  [200, 80, 10]    as const,  // Amber accent bar
  CAUTION_TEXT:    [180, 60, 0]     as const,  // Warning text
  FLAG_ARMED:      [180, 20, 20]    as const,  // ARMED & DANGEROUS
  FLAG_WARRANT:    [200, 60, 0]     as const,  // Active warrant
  FLAG_GANG:       [120, 40, 140]   as const,  // Gang affiliation
  FLAG_MENTAL:     [40, 90, 170]    as const,  // Mental health
  FLAG_MEDICAL:    [0, 130, 80]     as const,  // Medical condition
  FLAG_DEFAULT:    [80, 80, 90]     as const,  // Generic flag

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
  SIZE_SECTION_TITLE:     7,     // Section header bar text (all-caps, Helvetica Bold 7pt)
  SIZE_FIELD_VALUE:       8,     // Courier values (compact without box borders)
  SIZE_FIELD_LABEL:       5,     // Helvetica Bold labels above field boxes
  SIZE_TABLE_HEADER:      6.5,   // Helvetica column headers
  SIZE_TABLE_BODY:        7.5,   // Courier table row content
  SIZE_FOOTER_PRIMARY:    6,     // Footer form #, page #
  SIZE_FOOTER_SECONDARY:  5,     // Footer secondary info
  SIZE_SMALL_META:        5.5,   // Form revision, report date
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
  SIZE_FORM_CELL_LABEL:   6,     // Form cell label (same as field label)
  SIZE_FORM_CELL_VALUE:   8.5,   // Form cell value (same as field value)
  SIZE_SIDEBAR_TAB:       7,     // Sidebar tab rotated text
} as const;

// ── Border / Line Width Tokens ───────────────────────────────

export const BORDER = {
  SECTION_OUTER:    0.5,   // Border around sections (clean)
  FIELD:            0.3,   // Field box borders (0.3pt, clean grid)
  TABLE_OUTER:      0.5,   // Outer border of tables
  TABLE_ROW:        0.15,  // Row separators (subtle)
  TABLE_COLUMN:     0.15,  // Column separators (subtle)
  CHECKBOX:         0.3,   // Checkbox square border
  CHECK_MARK:       0.6,   // Check mark stroke
  SIGNATURE_LINE:   0.4,   // Signature line
  ACCENT_HEADER:    0.8,   // Accent line below header
  ACCENT_FOOTER:    0.4,   // Accent line above footer
  CASE_BOX:         1.0,   // White border inside case number box
  BANNER:           0.8,   // Banner borders
  DIAGRAM_GRID:     0.1,   // Accident diagram grid lines
  FORM_CELL:        0.25,  // Form cell borders (subtle grid)
  SIDEBAR_TAB:      0.25,  // Sidebar tab border
  FORM_GRID_OUTER:  0.5,   // Bold outer border around form grid
} as const;

// ── Spacing Tokens (tighter throughout) ──────────────────────

export const SPACING = {
  XS:                 0.1,   // Micro padding
  SM:                 0.5,   // Small gap
  MD:                 1,     // Base unit
  LG:                 2,     // Line height
  XL:                 2.5,   // Generous gap

  CONTENT_INSET:      1,     // Left/right padding inside sections
  SECTION_HEADER_H:   3.8,   // Section header bar height (compact)
  SECTION_GAP:        0.5,   // Gap between sections (minimal)
<<<<<<< HEAD
  SECTION_CONTENT_PAD: 2.0,  // Gap from header bar to first content
=======
  SECTION_CONTENT_PAD: 1.2,  // Gap from header bar to first content (tight)
>>>>>>> main
  SECTION_BOTTOM_PAD:  0.2,  // Padding inside section before bottom border

  FIELD_ROW_HEIGHT:   2.8,   // Value area height (no box, just label+value)
  FIELD_ROW_ADVANCE:  2.8,   // Y-advance after field row (tight)

  SIGNATURE_BOX_H:    20,    // Signature block total height (compact)
  SIGNATURE_ROLE_H:   4,     // Role label header bar height
  SIGNATURE_SUB_GAP:  4,     // Gap between sig line and sub-fields

  FORM_CELL_PAD:      0.5,   // Padding inside form cells (tight)
  FORM_CELL_LABEL_H:  2,     // Form cell label strip height (compact)
  FORM_CELL_H:        7,     // Form cell total height (compact)
} as const;

// ── Layout Tokens ────────────────────────────────────────────

export const LAYOUT = {
  PAGE_MARGIN:       10,     // Tighter margins for max content area
  HEADER_HEIGHT:     16,     // Header bar
  FOOTER_HEIGHT:     7,      // Footer (compact, closer to content)
  HEADER_TOP:        5,      // Y-start of header bar
  CLASSIF_BAR_H:     4.5,    // Classification bar height
  SEAL_SIZE:         13,     // Compact logo
  ACCENT_STRIP_H:    0.8,   // Thin accent strip below header
  CASE_BOX_W:        42,     // Case number box width
  LINE_HEIGHT:       2.8,    // Base line height for wrapped text (compact)
  DIAGRAM_GRID_STEP: 10,     // Grid spacing in accident diagram
  SIDEBAR_TAB_W:     18,     // Sidebar tab width
} as const;

// ── Computed Layout Helpers ──────────────────────────────────

/** Page content width = pageWidth - 2 * PAGE_MARGIN */
export function getContentWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth() - 2 * LAYOUT.PAGE_MARGIN;
}

/** Grid start X: right edge of sidebar tab */
export function getGridStartX(): number {
  return LAYOUT.PAGE_MARGIN + LAYOUT.SIDEBAR_TAB_W;
}

/** Grid content width: page width minus margins minus sidebar tab */
export function getGridContentWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth() - 2 * LAYOUT.PAGE_MARGIN - LAYOUT.SIDEBAR_TAB_W;
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
  if (!ratios || ratios.length === 0) return [getLeftX()];
  const totalRatio = ratios.reduce((a, b) => a + b, 0) || 1;
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
