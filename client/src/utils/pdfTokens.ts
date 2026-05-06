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
  TEXT_SECONDARY:  [74, 85, 104]    as const,  // Helvetica labels (#545454)
  TEXT_TERTIARY:   [100, 100, 100]  as const,  // Placeholders, sub-labels
  TEXT_INVERTED:   [255, 255, 255]  as const,  // White on dark backgrounds
  TEXT_MUTED:      [140, 140, 140]  as const,  // Form number, report date

  // Borders — clean, professional lines
  // Border palette — darkened 2026-05-05 design-definition pass.
  // The previous values produced a soft, government-form-faded look;
  // sharper, darker rule colors give the report the crisp visual
  // structure of a real PD form where every cell is bounded by a
  // visible line. Field bodies stay white; only the rule colors
  // change.
  BORDER_FIELD:    [80, 92, 110]    as const,  // Field box borders (was 113/128/150)
  BORDER_TABLE:    [120, 122, 130]  as const,  // Row separator lines (was 180/180/185)
  BORDER_COLUMN:   [110, 112, 122]  as const,  // Vertical column separators (was 170/170/175)
  BORDER_OUTER:    [40, 44, 55]     as const,  // Table outer border (was 80/80/85)
  BORDER_SECTION:  [50, 55, 68]     as const,  // Section outline (was 100/100/105)
  BORDER_FIELD_RULE: [140, 148, 162] as const, // Field underline rule (was 200/200/208 — soft)

  // Backgrounds — page stays white; structural elements (headers,
  // banners) deepen to true charcoal for strong contrast against
  // white field bodies (2026-05-05 darker-shading pass).
  BG_ZEBRA:        [242, 242, 246]  as const,  // Even-row table shading
  BG_SECTION_HDR:  [44, 50, 64]     as const,  // Subheader bar (was 22/26/34 — lightened 2026-05-05 per user)
  BG_TABLE_HDR:    [54, 60, 76]     as const,  // Table column header (proportionally lightened)
  BG_SECTION_TINT: [248, 248, 252]  as const,  // Field-body tint (kept near-white for readability)
  BG_TABLE_HDR_LIGHT: [220, 225, 234] as const, // Nested table header (light slate)
  TEXT_TABLE_HDR_LIGHT: [45, 55, 72]  as const,  // Dark slate text on light hdr

  // Brand accent — pivoted to grayscale 2026-05-04 (user request).
  // Token name retained for backwards compatibility with existing call
  // sites; the underlying value is now a dark charcoal so every site
  // that previously rendered a gold accent (agency header strip,
  // quick-reference banner left rule, district bar accent, notes entry
  // left rule, horizontal section dividers) automatically becomes
  // grayscale via this single point of change.
  ACCENT_GOLD:     [60, 60, 60]     as const,  // dark charcoal accent

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

  // Police-form furniture (added 2026-04-17 for enhanced LE styling)
  RULE_GOLD:           [80, 80, 80]     as const,  // Dark gray accent rule (was gold; grayscale 2026-05-04)
  RULE_STRONG:         [30, 30, 30]     as const,  // Heavy black rule for top/bottom
  BATES_STAMP:         [90, 50, 50]     as const,  // Muted burgundy for Bates sequence
  BARCODE_BAR:         [0, 0, 0]        as const,  // Code 39 black bars
  BARCODE_BG:          [255, 255, 255]  as const,  // Code 39 white space
  BARCODE_STRIP_BG:    [250, 250, 250]  as const,  // Light strip background for scan row
  BARCODE_STRIP_RULE:  [180, 180, 185]  as const,
  CERT_BG:             [248, 246, 238]  as const,  // Ivory certification paragraph bg
  CERT_RULE:           [160, 140, 90]   as const,  // Olive rule around cert block
  MUGSHOT_RULE:        [60, 60, 60]     as const,  // Dark frame around arrest photo

  // Priority bar palette (separate from PRIORITY_COLORS in pdfGenerator.ts —
  // these are the tokenized fills used by drawPriorityBar helper)
  PRIO_1_BG:           [185, 25, 25]    as const,  // Emergency / Code 3
  PRIO_2_BG:           [210, 110, 20]   as const,  // Urgent
  PRIO_3_BG:           [200, 160, 30]   as const,  // Routine
  PRIO_4_BG:           [60, 120, 70]    as const,  // Non-emergency
  PRIO_FG:             [255, 255, 255]  as const,
} as const;

// ── Classification Markings (CJIS Security Policy / Traffic Light Protocol) ──
// Top + bottom banner colors applied to every page of a generated report.

export interface ClassificationSpec {
  readonly bg: RGBColor;
  readonly fg: RGBColor;
  readonly label: string;
}

export const CLASSIFICATION: Record<
  'LES' | 'CUI' | 'FOUO' | 'UNCLAS' | 'CONFIDENTIAL' | 'SEALED' | 'DRAFT',
  ClassificationSpec
> = {
  LES:          { bg: [180, 30, 30],  fg: [255, 255, 255], label: 'LAW ENFORCEMENT SENSITIVE // CJIS' },
  CUI:          { bg: [80, 50, 130],  fg: [255, 255, 255], label: 'CONTROLLED UNCLASSIFIED INFORMATION // LE' },
  FOUO:         { bg: [200, 130, 20], fg: [0, 0, 0],       label: 'FOR OFFICIAL USE ONLY' },
  UNCLAS:       { bg: [0, 110, 60],   fg: [255, 255, 255], label: 'UNCLASSIFIED' },
  CONFIDENTIAL: { bg: [120, 0, 0],    fg: [255, 255, 255], label: 'CONFIDENTIAL // NOFORN' },
  SEALED:       { bg: [30, 30, 30],   fg: [255, 215, 0],   label: 'SEALED BY COURT ORDER -- DO NOT DISSEMINATE' },
  DRAFT:        { bg: [110, 110, 110], fg: [255, 255, 255], label: 'DRAFT -- UNOFFICIAL -- NOT FOR DISTRIBUTION' },
} as const;

export type ClassificationLevel = keyof typeof CLASSIFICATION;

// ── Font Profile ─────────────────────────────────────────────
// Switches the font used for value/body text across every PDF form.
//
// MODERN (default, 2026-04-17): 'helvetica' — Arial-equivalent, formal
//   sans-serif look. Available in jsPDF's built-in font set (no custom
//   font loading required). Applied to field values, table bodies,
//   narrative text, and continuation headers.
//
// LEGACY (backup):            'courier' — typewriter police-report look.
//   If the modern profile doesn't meet visual requirements, swap back to
//   courier by changing this single constant:
//     export const PDF_VALUE_FONT: jsPDF.FontName = 'courier';
//
// Labels (small-caps headers) remain helvetica bold in both profiles.
// Monospace-critical contexts (Bates stamps, Code 39 barcode labels) use
// the font passed explicitly in their renderers, not this token.
export const PDF_VALUE_FONT: 'helvetica' | 'courier' | 'times' = 'helvetica';

// ── Typography Tokens ────────────────────────────────────────
// Values: Helvetica (formal, Arial-equivalent) — see PDF_VALUE_FONT above
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
  SIZE_CLASSIFICATION:    8,     // Classification banner text (top/bottom)
  SIZE_CERTIFICATION:     6.8,   // Officer certification paragraph
  SIZE_BATES:             7.2,   // Bates stamp monospace
  SIZE_CAUTION_CHIP:      6.8,   // Flag chips in caution strip
  SIZE_CAUTION_LABEL:     8.5,   // "CAUTION — OFFICER SAFETY" bar label
  SIZE_PRIORITY_BAR:      9,     // "PRIORITY 1 — EMERGENCY" bar label
  SIZE_BARCODE_LABEL:     5.5,   // Code 39 human-readable line
  SIZE_ORI_LINE:          6.5,   // Tri-line agency identifier (ORI/FBI/NCIC)
  SIZE_BADGE_LABEL:       5,     // "BADGE" / "POST" mini-labels
  SIZE_BADGE_VALUE:       7.5,   // Badge # + POST # value
  SIZE_TIMELINE_LABEL:    5.5,   // Dispatch timeline stage label
  SIZE_TIMELINE_VALUE:    7,     // Dispatch timeline timestamp
  SIZE_COC_HEADER:        5.5,   // Chain of custody column header
  SIZE_COC_VALUE:         7,     // Chain of custody value line
  SIZE_BARCODE_STRIP:     9,     // Top-of-page barcode scan strip value
  SIZE_MUGSHOT_LABEL:     5.5,   // Mugshot frame caption
  SIZE_NARRATIVE_PARA:    8,     // Narrative body text
  SIZE_PARA_MARKER:       8.5,   // ¶N bold paragraph marker
} as const;

// ── Border / Line Width Tokens ───────────────────────────────

export const BORDER = {
  // Line widths — bumped 2026-05-05 design-definition pass.
  // Each rule that bounds a structural element gets ~50-60% thicker
  // so the report grid feels like a deliberate police-form layout
  // rather than a faint outline. Decorative grid lines (DIAGRAM_GRID,
  // SIDEBAR_TAB) are unchanged.
  SECTION_OUTER:    0.7,   // Border around sections (was 0.5)
  FIELD:            0.4,   // Field box borders (was 0.3)
  TABLE_OUTER:      0.7,   // Outer border of tables (was 0.5)
  TABLE_ROW:        0.25,  // Row separators (was 0.15)
  TABLE_COLUMN:     0.25,  // Column separators (was 0.15)
  CHECKBOX:         0.4,   // Checkbox square border (was 0.3)
  CHECK_MARK:       0.6,   // Check mark stroke
  SIGNATURE_LINE:   0.5,   // Signature line (was 0.4)
  ACCENT_HEADER:    1.0,   // Accent line below header (was 0.8)
  ACCENT_FOOTER:    0.6,   // Accent line above footer (was 0.5)
  ACCENT_SECTION:   2.0,   // Section header left-accent strip (was 1.5 — bolder anchor)
  FIELD_UNDERLINE:  0.3,   // Field underline rule (was 0.15 — visibly defined)
  CASE_BOX:         1.0,   // White border inside case number box
  BANNER:           0.8,   // Banner borders
  DIAGRAM_GRID:     0.1,   // Accident diagram grid lines
  FORM_CELL:        0.25,  // Form cell borders (subtle grid)
  SIDEBAR_TAB:      0.25,  // Sidebar tab border
  FORM_GRID_OUTER:  0.5,   // Bold outer border around form grid
  CLASSIFICATION:   0,     // Classification bars are filled, no stroke
  CLASSIFICATION_RULE: 0.5, // Gold rule under top classification bar
  CERT_BOX:         0.6,   // Officer certification block border
  CAUTION_STRIP:    0.8,   // Caution strip outer border
  PRIORITY_BAR:     0.6,   // Priority bar outer border
  TIMELINE_CELL:    0.25,  // Dispatch timeline cell dividers
  TIMELINE_OUTER:   0.5,   // Dispatch timeline outer border
  COC_ROW:          0.25,  // Chain of custody row divider
  COC_OUTER:        0.5,   // Chain of custody outer border
  BARCODE_STRIP:    0.4,   // Barcode scan strip border
  MUGSHOT_FRAME:    0.7,   // Mugshot frame
  NARRATIVE_RULE:   0.3,   // Left-margin vertical rule on narrative
} as const;

// ── Spacing Tokens (tighter throughout) ──────────────────────

export const SPACING = {
  XS:                 0.1,   // Micro padding
  SM:                 0.5,   // Small gap
  MD:                 1,     // Base unit
  LG:                 2,     // Line height
  XL:                 2.5,   // Generous gap

  CONTENT_INSET:      1,     // Left/right padding inside sections
  SECTION_HEADER_H:   4.5,   // Section header bar height (readable with accent strip)
  SECTION_GAP:        1.0,   // Gap between sections (compact but visible)
  // Breathing room between section header bar and first content row.
  // 2mm gives the first label space to sit below the bar without hugging —
  // e.g. "INCIDENT OVERVIEW" bar → ~2mm gap → "INCIDENT NUMBER" label.
  // Small enough that form height doesn't balloon across multi-section forms.
  SECTION_CONTENT_PAD: 2,
  SECTION_BOTTOM_PAD:  0.5,  // Padding inside section before bottom border

  FIELD_ROW_HEIGHT:   2.8,   // Value area height (no box, just label+value)
  FIELD_ROW_ADVANCE:  2.8,   // Y-advance after field row (tight)

  SIGNATURE_BOX_H:    20,    // Signature block total height (compact)
  SIGNATURE_ROLE_H:   4,     // Role label header bar height
  SIGNATURE_SUB_GAP:  4,     // Gap between sig line and sub-fields

  FORM_CELL_PAD:      0.5,   // Padding inside form cells (tight)
  FORM_CELL_LABEL_H:  2,     // Form cell label strip height (compact)
  FORM_CELL_H:        7,     // Form cell total height (compact)

  // Police-form furniture heights
  CLASSIFICATION_BAR_H: 4,   // Top/bottom classification banner height
  CAUTION_STRIP_H:      6.5, // Caution / officer-safety banner height
  PRIORITY_BAR_H:       3.8, // Priority bar height
  TIMELINE_ROW_H:       8.5, // Dispatch timeline row (label + value stacked)
  COC_ROW_H:            10,  // Chain of custody row (signature line height)
  COC_HEADER_H:         4.5, // Chain of custody header strip
  CERT_PARA_H:          12,  // Certification paragraph height
  CERT_SIG_H:           14,  // Certification signature row height
  BARCODE_STRIP_H:      9,   // Barcode scan strip height (top of every page)
  BARCODE_INLINE_H:     8,   // Inline barcode under case number in header
  BARCODE_QUIET:        1.5, // Code 39 quiet zone on each side (mm)
  MUGSHOT_W:            28,  // Arrest photo width
  MUGSHOT_H:            35,  // Arrest photo height (4:5)
  MUGSHOT_CAP_H:        4,   // Caption strip under mugshot
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
  // Brother PJ-700/800 mobile thermal printers have a hardware ~6mm
  // leading-edge dead zone — anything within 6mm of the top of a sheet
  // gets clipped. When a doc is tagged for 'mobile' print target, the
  // top y-edge gets pushed down by this amount so the dead zone
  // becomes safe whitespace instead of clipped content.
  MOBILE_PRINTER_TOP_OFFSET: 6,
} as const;

// ── Print Target ─────────────────────────────────────────────
// 'office' = laser/letter — standard 10mm top margin
// 'mobile' = Brother PJ-700/800 thermal — 10mm + 6mm dead-zone offset
export type PrintTarget = 'office' | 'mobile';

/** Tag a jsPDF instance with its print target. The tag is read by
 *  topMarginY(doc) to apply the mobile-printer offset. */
export function applyPrintTarget(doc: jsPDF, target: PrintTarget): void {
  (doc as any).__printTarget = target;
}

/** Read the print target previously applied to a doc. Defaults to
 *  'office' for untagged documents — this means existing call sites
 *  that don't yet thread the target keep their current behavior. */
export function getPrintTarget(doc: jsPDF): PrintTarget {
  return ((doc as any).__printTarget as PrintTarget | undefined) ?? 'office';
}

/** Top y-edge for content on the current page. Use this anywhere
 *  LAYOUT.PAGE_MARGIN was used as a vertical TOP margin — NOT for
 *  left/right/bottom margins. Returns 10mm for office, 16mm for mobile. */
export function topMarginY(doc: jsPDF): number {
  return LAYOUT.PAGE_MARGIN + (getPrintTarget(doc) === 'mobile' ? LAYOUT.MOBILE_PRINTER_TOP_OFFSET : 0);
}

/** Top y-edge for the agency/page header chrome — which sits ABOVE
 *  the content margin at LAYOUT.HEADER_TOP=5mm in office mode. On
 *  mobile mode it shifts down by MOBILE_PRINTER_TOP_OFFSET so the
 *  banner doesn't hit the PJ-700 leading-edge dead zone. */
export function topHeaderY(doc: jsPDF): number {
  return LAYOUT.HEADER_TOP + (getPrintTarget(doc) === 'mobile' ? LAYOUT.MOBILE_PRINTER_TOP_OFFSET : 0);
}

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

/** Approximate line height for a given font size (mm). PDF points: 1 pt = 0.3528 mm.
 *  Standard line height is 1.2× font size. */
export function getLineHeight(fontSizePt: number): number {
  return fontSizePt * 0.3528 * 1.2;
}

/** Approximate cap height (height of capital letters) for a given font size (mm).
 *  Cap height is typically ~70% of font size in points, converted to mm. */
export function getCapHeight(fontSizePt: number): number {
  return fontSizePt * 0.3528 * 0.7;
}

/**
 * Normalize an enum-like value for display.
 *
 * Database stores enum values as snake_case lowercase tokens
 * (`pso_client_request`, `in_progress`, `not_filed`). The PDF/UI
 * surface expects them rendered as "PSO CLIENT REQUEST", "IN PROGRESS",
 * etc. — readable, professional, and consistent across the system.
 *
 * Free-form text (names, addresses, narratives) passes through
 * untouched so we don't accidentally uppercase user-entered names
 * like "Christopher Zamora" into "CHRISTOPHER ZAMORA". The heuristic:
 * a value is enum-like if it's a single token of lowercase letters /
 * digits / underscores, OR if it contains an underscore at all.
 *
 * Returns '' for null/undefined/empty so callers can chain it with
 * `|| ''` fallbacks.
 */
export function formatEnumValue(s: string | null | undefined): string {
  if (s == null) return '';
  const trimmed = String(s).trim();
  if (!trimmed) return '';
  const isEnumLike = /^[a-z][a-z0-9_]*$/.test(trimmed) || /_/.test(trimmed);
  return isEnumLike ? trimmed.replace(/_/g, ' ').toUpperCase() : trimmed;
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
