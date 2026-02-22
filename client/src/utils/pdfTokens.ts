// ============================================================
// RMPG Flex — PDF Design Token System
// Centralized visual primitives for all PDF generators
// All colors, typography, borders, spacing, and layout helpers
// ============================================================

import jsPDF from 'jspdf';

// ── Color Tokens (RGB tuples) ────────────────────────────────

export type RGBColor = readonly [number, number, number];

export const COLOR = {
  // Text hierarchy
  TEXT_PRIMARY:    [0, 0, 0]        as const,  // Field values, narrative body
  TEXT_SECONDARY:  [80, 80, 80]     as const,  // Labels, checkbox text
  TEXT_TERTIARY:   [120, 120, 120]  as const,  // Placeholders, sub-labels, "None recorded"
  TEXT_INVERTED:   [255, 255, 255]  as const,  // White on dark backgrounds
  TEXT_MUTED:      [160, 160, 160]  as const,  // Form number, report date metadata

  // Borders
  BORDER_FIELD:    [160, 160, 160]  as const,  // Field box borders
  BORDER_TABLE:    [200, 200, 200]  as const,  // Row separator lines
  BORDER_COLUMN:   [180, 180, 180]  as const,  // Vertical column separators
  BORDER_OUTER:    [100, 100, 100]  as const,  // Table outer border

  // Backgrounds
  BG_ZEBRA:        [245, 245, 248]  as const,  // Even-row table shading

  // Financial
  AMOUNT_CREDIT:   [0, 120, 60]     as const,  // Discounts, payments (unified green)
  AMOUNT_DEBIT:    [180, 0, 0]      as const,  // Late fees, penalties

  // Watermark
  WATERMARK:       [120, 120, 120]  as const,
} as const;

// ── Typography Tokens ────────────────────────────────────────

export const FONT = {
  SIZE_HEADER_TITLE:      14,    // Agency name in header bar
  SIZE_SECTION_TITLE:     10,    // Section header bar text
  SIZE_FIELD_VALUE:       9,     // Values inside field boxes
  SIZE_FIELD_LABEL:       6,     // Labels above values in boxes
  SIZE_TABLE_HEADER:      6,     // Column headers in tables
  SIZE_TABLE_BODY:        8,     // Table row content
  SIZE_FOOTER_PRIMARY:    5,     // Footer line 1 (form #, page #)
  SIZE_FOOTER_SECONDARY:  4.5,   // Footer line 2 (agency, timestamp)
  SIZE_SMALL_META:        5.5,   // Form revision, report date, case label
  SIZE_CHECKBOX_LABEL:    6,     // Checkbox labels (= FIELD_LABEL)
  SIZE_BANNER:            14,    // Large notice banners (Trespass Warning)
  SIZE_BANNER_SMALL:      8,     // Mandatory report banner, "None recorded"
  SIZE_WATERMARK_LARGE:   62,    // "CONFIDENTIAL"
  SIZE_WATERMARK_SMALL:   24,    // Agency name under watermark
  SIZE_SIGNATURE_X:       8,     // "X" marker on signature line
  SIZE_SIGNATURE_LABEL:   5,     // "SIGNATURE", "PRINTED NAME"
  SIZE_BALANCE_DUE:       11,    // Invoice balance due
  SIZE_TOTAL_LABEL:       10,    // Invoice "TOTAL:" label
  SIZE_CLASSIF_BAR:       7,     // Classification/priority bar
  SIZE_SUBHEADER:         7,     // Subheader text in report header
  SIZE_REPORT_TYPE:       8,     // Report type label in header
  SIZE_CASE_NUMBER:       9,     // Case number value (courier bold)
} as const;

// ── Border / Line Width Tokens ───────────────────────────────

export const BORDER = {
  SECTION_OUTER:    0.6,   // Thick border around sections
  FIELD:            0.2,   // Field box borders
  TABLE_OUTER:      0.4,   // Outer border of tables
  TABLE_ROW:        0.2,   // Horizontal row separators
  TABLE_COLUMN:     0.2,   // Vertical column separators
  CHECKBOX:         0.3,   // Checkbox square border
  CHECK_MARK:       0.6,   // Check mark stroke
  SIGNATURE_LINE:   0.5,   // Signature line
  ACCENT_HEADER:    0.8,   // Gold accent line below header
  ACCENT_FOOTER:    0.4,   // Gold accent line above footer
  CASE_BOX:         1.0,   // White border inside case number box
  BANNER:           0.8,   // UoF mandatory banner, trespass banner
  DIAGRAM_GRID:     0.1,   // Accident diagram grid lines
} as const;

// ── Spacing Tokens (3mm base unit) ───────────────────────────

export const SPACING = {
  XS:                 1,     // 1mm — tight padding
  SM:                 2,     // 2mm — small gap
  MD:                 3,     // 3mm — base unit / content inset
  LG:                 5,     // 5mm — line height
  XL:                 6,     // 6mm — between sections

  CONTENT_INSET:      3,     // Left/right padding inside sections
  SECTION_HEADER_H:   9,     // Height of section header bar
  SECTION_GAP:        3,     // Gap after closeAutoSection

  FIELD_ROW_HEIGHT:   9,     // Height of field box
  FIELD_ROW_ADVANCE:  10,    // Y-advance after field row (height + 1mm gap)

  SIGNATURE_BOX_H:    30,    // Signature block total height
  SIGNATURE_ROLE_H:   5,     // Role label header bar height
  SIGNATURE_SUB_GAP:  5,     // Gap between sig line and sub-fields
} as const;

// ── Layout Tokens ────────────────────────────────────────────

export const LAYOUT = {
  PAGE_MARGIN:       18,
  HEADER_HEIGHT:     30,
  FOOTER_HEIGHT:     12,
  HEADER_TOP:        10,     // Y-start of header bar
  CLASSIF_BAR_H:     6,      // Classification bar height
  SEAL_SIZE:         14,     // Seal image dimensions in header
  CASE_BOX_W:        52,     // Case number box width
  LINE_HEIGHT:       5,      // Base line height for wrapped text
  DIAGRAM_GRID_STEP: 10,     // Grid spacing in accident diagram
} as const;

// ── Computed Layout Helpers ──────────────────────────────────

/** Page content width = pageWidth - 2 * PAGE_MARGIN */
export function getContentWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth() - 2 * LAYOUT.PAGE_MARGIN;
}

/** Half-column width for 2-column layouts (with 5mm gap between columns) */
export function getHalfWidth(doc: jsPDF): number {
  return (getContentWidth(doc) - SPACING.LG) / 2;
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

/** One-quarter width for 4-column layouts (with 3mm gaps) */
export function getQuarterWidth(doc: jsPDF): number {
  return (getContentWidth(doc) - 2 * SPACING.CONTENT_INSET - 3 * SPACING.MD) / 4;
}
