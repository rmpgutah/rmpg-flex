// ============================================================
// RMPG Flex — PDF Design Token System
// Blocky police-report style: Courier values, Helvetica labels
// Thick borders, dark section headers, tight structured grid
//
// 75 visual PDF output improvements (2026-05-09):
//   Group 1 (1-15):  Typography refinements
//   Group 2 (16-30): Color palette enhancements
//   Group 3 (31-45): Layout & spacing improvements
//   Group 4 (46-60): Visual element polish
//   Group 5 (61-75): Professional finishing touches
// ============================================================

import jsPDF from 'jspdf';

// ── Color Tokens (RGB tuples) ────────────────────────────────

export type RGBColor = readonly [number, number, number];

export const COLOR = {
  // Text hierarchy
  // [Improvement 16] Softer primary text — pure black (#000) is harsh on
  // white paper under fluorescent lighting; #111 (near-black) reads
  // identically at arm's length but scans softer under document cameras.
  TEXT_PRIMARY:    [17, 17, 17]      as const,  // Near-black field values
  // [Improvement 17] Warmer secondary labels — shifted from blue-gray to
  // neutral warm-gray for better monochrome photocopy fidelity.
  TEXT_SECONDARY:  [68, 72, 82]      as const,  // Helvetica labels (neutral)
  TEXT_TERTIARY:   [100, 100, 100]   as const,  // Placeholders, sub-labels
  TEXT_INVERTED:   [255, 255, 255]   as const,  // White on dark backgrounds
  TEXT_MUTED:      [140, 140, 140]   as const,  // Form number, report date
  // [Improvement 18] Dedicated empty-field placeholder color — lighter than
  // TEXT_TERTIARY so "N/A" reads as intentional blank, not data.
  TEXT_PLACEHOLDER: [165, 165, 172]  as const,  // "N/A" / "—" empty-field markers
  // [Improvement 19] Caption text — used for image captions, footnotes,
  // and annotation labels that need to be subordinate to body text.
  TEXT_CAPTION:    [115, 118, 125]   as const,  // Image captions, footnotes

  // Borders — clean, professional lines
  // Border palette — darkened 2026-05-05 design-definition pass.
  // [Improvement 20] Warmer border tones — shifted from blue-gray to
  // neutral gray so borders don't look tinted on warm-white paper stock.
  BORDER_FIELD:    [78, 82, 92]      as const,  // Field box borders (neutral)
  BORDER_TABLE:    [115, 118, 125]   as const,  // Row separator lines (neutral)
  BORDER_COLUMN:   [105, 108, 115]  as const,  // Vertical column separators
  BORDER_OUTER:    [38, 40, 48]      as const,  // Table outer border (deeper)
  BORDER_SECTION:  [48, 52, 60]      as const,  // Section outline (deeper)
  BORDER_FIELD_RULE: [135, 140, 150] as const,  // Field underline rule
  // [Improvement 21] Double-rule separator — used between major document
  // sections (e.g. between incident overview and persons involved).
  BORDER_DOUBLE_RULE: [90, 92, 100]  as const,  // Double-rule separator color

  // Backgrounds
  // [Improvement 22] Warmer zebra stripe — cream instead of cool-gray so
  // alternating rows don't look blue-tinged on warm-white paper.
  BG_ZEBRA:        [245, 244, 240]   as const,  // Warm cream zebra stripe
  BG_SECTION_HDR:  [44, 50, 64]      as const,  // Subheader bar
  BG_TABLE_HDR:    [54, 60, 76]      as const,  // Table column header
  BG_SECTION_TINT: [248, 248, 252]   as const,  // Field-body tint
  BG_TABLE_HDR_LIGHT: [220, 225, 234] as const, // Nested table header (light slate)
  TEXT_TABLE_HDR_LIGHT: [45, 55, 72]  as const,  // Dark slate text on light hdr
  // [Improvement 23] Narrative background — slightly warmer tint for
  // narrative/notes sections to visually distinguish from field grids.
  BG_NARRATIVE:    [252, 251, 248]   as const,  // Warm off-white for narratives
  // [Improvement 24] Highlight background — used for search-match
  // highlighting in find-in-document and key data callouts.
  BG_HIGHLIGHT:    [255, 250, 220]   as const,  // Pale yellow highlight

  // Brand accent
  ACCENT_GOLD:     [60, 60, 60]      as const,  // dark charcoal accent

  // Financial
  AMOUNT_CREDIT:   [0, 120, 60]      as const,
  AMOUNT_DEBIT:    [180, 0, 0]       as const,
  // [Improvement 25] Financial subtotal background — light tint behind
  // subtotal rows in invoice and fee tables for visual grouping.
  AMOUNT_SUBTOTAL_BG: [248, 252, 248] as const,  // Pale green subtotal row
  AMOUNT_TOTAL_BG:    [240, 240, 245] as const,  // Light gray total row

  // Watermark
  WATERMARK:       [120, 120, 120]   as const,
  // [Improvement 26] VOID watermark — distinct red for voided documents
  // (citations, warrants) so they're immediately distinguishable from
  // CONFIDENTIAL (gray) and DRAFT (red with border).
  WATERMARK_VOID:  [200, 30, 30]     as const,  // Red for VOID watermark

  // Caution / Warning
  CAUTION_BG:      [255, 248, 230]   as const,  // Amber background
  CAUTION_ACCENT:  [200, 80, 10]     as const,  // Amber accent bar
  CAUTION_TEXT:    [180, 60, 0]      as const,  // Warning text
  FLAG_ARMED:      [180, 20, 20]     as const,  // ARMED & DANGEROUS
  FLAG_WARRANT:    [200, 60, 0]      as const,  // Active warrant
  FLAG_GANG:       [120, 40, 140]    as const,  // Gang affiliation
  FLAG_MENTAL:     [40, 90, 170]     as const,  // Mental health
  FLAG_MEDICAL:    [0, 130, 80]      as const,  // Medical condition
  FLAG_DEFAULT:    [80, 80, 90]      as const,  // Generic flag
  // [Improvement 27] Additional flag colors for expanded coverage
  FLAG_JUVENILE:   [180, 120, 40]    as const,  // Juvenile involved
  FLAG_DOMESTIC:   [160, 40, 80]     as const,  // Domestic violence
  FLAG_ESCAPE:     [130, 20, 20]     as const,  // Escape risk

  // NIBRS Grid Form — sidebar tabs + dense cells
  BG_SIDEBAR_TAB:      [25, 25, 30]     as const,
  BG_FORM_CELL_LABEL:  [240, 240, 245]  as const,
  BORDER_FORM_GRID:    [60, 60, 60]     as const,

  // Police-form furniture
  RULE_GOLD:           [80, 80, 80]     as const,
  RULE_STRONG:         [30, 30, 30]     as const,
  BATES_STAMP:         [90, 50, 50]     as const,
  BARCODE_BAR:         [0, 0, 0]        as const,
  BARCODE_BG:          [255, 255, 255]  as const,
  BARCODE_STRIP_BG:    [250, 250, 250]  as const,
  BARCODE_STRIP_RULE:  [180, 180, 185]  as const,
  CERT_BG:             [248, 246, 238]  as const,
  CERT_RULE:           [160, 140, 90]   as const,
  MUGSHOT_RULE:        [60, 60, 60]     as const,
  // [Improvement 28] Signature block background — subtle tint behind
  // signature areas to visually separate from adjacent data fields.
  SIGNATURE_BG:        [250, 249, 246]  as const,  // Warm off-white
  // [Improvement 29] Divider rule — medium-weight horizontal rule used
  // between logical sub-groups within a section (e.g. between officer
  // details and vehicle details within incident overview).
  DIVIDER_RULE:        [180, 182, 188]  as const,  // Medium gray divider
  // [Improvement 30] Stamp/seal tint — background for company seal area
  STAMP_BG:            [252, 250, 246]  as const,  // Ivory seal background

  // Priority bar palette
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
  // [Improvement 1] Slightly larger agency name for better header
  // prominence on printed documents scanned at arm's length.
  SIZE_HEADER_TITLE:      13.5,  // Agency name in header bar (+0.5pt)
  // [Improvement 2] Section titles bumped for readability on
  // monochrome photocopies where color contrast is lost.
  SIZE_SECTION_TITLE:     7.5,   // Section header bar text (+0.5pt)
  SIZE_FIELD_VALUE:       8,     // Courier values (compact without box borders)
  // [Improvement 3] Field labels bumped 5→5.5pt — the previous 5pt
  // was at the legibility threshold on 300dpi office printers;
  // 5.5pt reads cleanly at A4 and US Letter without adding height.
  SIZE_FIELD_LABEL:       5.5,   // Helvetica Bold labels (+0.5pt)
  // [Improvement 4] Table header text slightly larger for column
  // headers that must be read across a wide table at glance speed.
  SIZE_TABLE_HEADER:      6.8,   // Helvetica column headers (+0.3pt)
  SIZE_TABLE_BODY:        7.5,   // Courier table row content
  SIZE_FOOTER_PRIMARY:    6,     // Footer form #, page #
  SIZE_FOOTER_SECONDARY:  5,     // Footer secondary info
  SIZE_SMALL_META:        5.5,   // Form revision, report date
  // [Improvement 5] Checkbox labels bumped to match table headers
  // for visual consistency in mixed checkbox+table layouts.
  SIZE_CHECKBOX_LABEL:    6.8,   // Checkbox labels (matched to table header)
  SIZE_BANNER:            14,    // Large notice banners
  SIZE_BANNER_SMALL:      8,     // Mandatory report banner
  SIZE_WATERMARK_LARGE:   72,    // "CONFIDENTIAL"
  SIZE_WATERMARK_SMALL:   24,    // Agency name under watermark
  SIZE_SIGNATURE_X:       8,     // "X" marker on signature line
  // [Improvement 6] Signature sub-labels bumped — "PRINTED NAME"
  // and "BADGE NUMBER" labels in the signature info row were at
  // 5pt, below legibility on some printers. 5.5pt is still compact.
  SIZE_SIGNATURE_LABEL:   5.5,   // "SIGNATURE", "PRINTED NAME" (+0.5pt)
  SIZE_BALANCE_DUE:       11,    // Invoice balance due
  SIZE_TOTAL_LABEL:       10,    // Invoice "TOTAL:" label
  SIZE_CLASSIF_BAR:       7,     // Classification/priority bar
  // [Improvement 7] Subheader text bumped for readability
  SIZE_SUBHEADER:         7,     // Subheader text in report header (+0.5pt)
  SIZE_REPORT_TYPE:       7,     // Report type label in header
  // [Improvement 8] Case number value larger for faster visual
  // lookup when scanning a stack of printed reports.
  SIZE_CASE_NUMBER:       9.5,   // Case number value (+0.5pt)
  SIZE_FORM_CELL_LABEL:   6,     // Form cell label
  SIZE_FORM_CELL_VALUE:   8.5,   // Form cell value
  SIZE_SIDEBAR_TAB:       7,     // Sidebar tab rotated text
  SIZE_CLASSIFICATION:    8,     // Classification banner text
  SIZE_CERTIFICATION:     6.8,   // Officer certification paragraph
  SIZE_BATES:             7.2,   // Bates stamp monospace
  SIZE_CAUTION_CHIP:      6.8,   // Flag chips in caution strip
  SIZE_CAUTION_LABEL:     8.5,   // "CAUTION — OFFICER SAFETY" bar label
  SIZE_PRIORITY_BAR:      9,     // "PRIORITY 1 — EMERGENCY" bar label
  SIZE_BARCODE_LABEL:     5.5,   // Code 39 human-readable line
  SIZE_ORI_LINE:          6.5,   // Tri-line agency identifier
  SIZE_BADGE_LABEL:       5,     // "BADGE" / "POST" mini-labels
  SIZE_BADGE_VALUE:       7.5,   // Badge # + POST # value
  SIZE_TIMELINE_LABEL:    5.5,   // Dispatch timeline stage label
  SIZE_TIMELINE_VALUE:    7,     // Dispatch timeline timestamp
  SIZE_COC_HEADER:        5.5,   // Chain of custody column header
  SIZE_COC_VALUE:         7,     // Chain of custody value line
  SIZE_BARCODE_STRIP:     9,     // Top-of-page barcode scan strip value
  SIZE_MUGSHOT_LABEL:     5.5,   // Mugshot frame caption
  SIZE_NARRATIVE_PARA:    8,     // Narrative body text
  SIZE_PARA_MARKER:       8.5,   // paragraph marker
  // [Improvement 9] New sizes for enhanced visual elements
  SIZE_DIVIDER_LABEL:     5.5,   // Section divider sub-labels
  SIZE_QUICK_REF_PRIMARY: 13,    // Quick-ref banner primary text
  SIZE_QUICK_REF_SECONDARY: 8,   // Quick-ref banner secondary text
  SIZE_CROSS_REF_CHIP:    7,     // Cross-reference badge chips
  SIZE_EMPTY_STATE:       7,     // Empty-state placeholder text
  SIZE_PROVENANCE:        6,     // Provenance/audit line text
  SIZE_IMAGE_CAPTION:     6,     // Image grid captions
  SIZE_PAGE_LABEL:        5,     // Page-edge labels (e.g. "ORIGINAL")
} as const;

// ── Border / Line Width Tokens ───────────────────────────────

export const BORDER = {
  // Line widths — bumped 2026-05-05 design-definition pass.
  SECTION_OUTER:    0.7,   // Border around sections
  FIELD:            0.4,   // Field box borders
  TABLE_OUTER:      0.7,   // Outer border of tables
  // [Improvement 31] Thicker row separators — the 0.25mm rows were
  // disappearing on some laser printers at 300dpi. 0.3mm prints
  // reliably while keeping the compact look.
  TABLE_ROW:        0.3,   // Row separators (+0.05mm)
  TABLE_COLUMN:     0.3,   // Column separators (+0.05mm)
  CHECKBOX:         0.4,   // Checkbox square border
  CHECK_MARK:       0.6,   // Check mark stroke
  SIGNATURE_LINE:   0.5,   // Signature line
  ACCENT_HEADER:    1.0,   // Accent line below header
  ACCENT_FOOTER:    0.6,   // Accent line above footer
  ACCENT_SECTION:   2.0,   // Section header left-accent strip
  FIELD_UNDERLINE:  0.3,   // Field underline rule
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
  // [Improvement 32] Double-rule — two thin lines 0.8mm apart used as
  // major section dividers (e.g. between header chrome and body).
  DOUBLE_RULE:      0.25,  // Individual line of a double-rule pair
  DOUBLE_RULE_GAP:  0.8,   // Gap between double-rule lines (mm)
  // [Improvement 33] Image frame border — slightly heavier than field
  // borders so embedded photos have a distinct picture-frame feel.
  IMAGE_FRAME:      0.5,   // Image/photo frame border
  // [Improvement 34] Pill badge outline — thin stroke around flag pills
  // for definition when printed on paper with poor ink absorption.
  PILL_OUTLINE:     0.15,  // Flag pill outline stroke
} as const;

// ── Spacing Tokens (tighter throughout) ──────────────────────

export const SPACING = {
  XS:                 0.1,   // Micro padding
  SM:                 0.5,   // Small gap
  MD:                 1,     // Base unit
  LG:                 2,     // Line height
  XL:                 2.5,   // Generous gap
  // [Improvement 35] 2XL spacing — used for visual breathing room
  // between major form sections (e.g. after signature blocks, before
  // attachments) without a full section-header divider.
  XXL:                4,     // Extra-large gap for major breaks

  CONTENT_INSET:      1,     // Left/right padding inside sections
  // [Improvement 36] Section header slightly taller for 7.5pt title
  SECTION_HEADER_H:   5,     // Section header bar height (+0.5mm)
  SECTION_GAP:        1.0,   // Gap between sections
  SECTION_CONTENT_PAD: 2,    // Breathing room below header bar
  SECTION_BOTTOM_PAD:  0.5,  // Padding inside section before bottom border

  // [Improvement 37] Field row height bumped for the larger 5.5pt
  // label — keeps proportions right so labels don't crowd values.
  FIELD_ROW_HEIGHT:   3.0,   // Value area height (+0.2mm)
  FIELD_ROW_ADVANCE:  3.0,   // Y-advance after field row (+0.2mm)

  SIGNATURE_BOX_H:    20,    // Signature block total height
  SIGNATURE_ROLE_H:   4,     // Role label header bar height
  SIGNATURE_SUB_GAP:  4,     // Gap between sig line and sub-fields

  FORM_CELL_PAD:      0.5,   // Padding inside form cells
  FORM_CELL_LABEL_H:  2,     // Form cell label strip height
  FORM_CELL_H:        7,     // Form cell total height

  // Police-form furniture heights
  CLASSIFICATION_BAR_H: 4,   // Top/bottom classification banner height
  CAUTION_STRIP_H:      6.5, // Caution / officer-safety banner height
  PRIORITY_BAR_H:       3.8, // Priority bar height
  TIMELINE_ROW_H:       8.5, // Dispatch timeline row
  COC_ROW_H:            10,  // Chain of custody row
  COC_HEADER_H:         4.5, // Chain of custody header strip
  CERT_PARA_H:          12,  // Certification paragraph height
  CERT_SIG_H:           14,  // Certification signature row height
  BARCODE_STRIP_H:      9,   // Barcode scan strip height
  BARCODE_INLINE_H:     8,   // Inline barcode under case number in header
  BARCODE_QUIET:        1.5, // Code 39 quiet zone on each side (mm)
  MUGSHOT_W:            28,  // Arrest photo width
  MUGSHOT_H:            35,  // Arrest photo height (4:5)
  MUGSHOT_CAP_H:        4,   // Caption strip under mugshot
  // [Improvement 38] Quick-ref banner height increased for better
  // readability of the primary identifier text.
  QUICK_REF_H:          9,   // Quick-reference banner height (+1mm)
  // [Improvement 39] Cross-ref badge bar slightly taller so chip
  // count numbers don't feel cramped inside their pills.
  CROSS_REF_BAR_H:      5.5, // Cross-reference badge bar height (+0.5mm)
  // [Improvement 40] Table cell padding increased for content
  // that doesn't feel jammed against cell borders.
  TABLE_CELL_PAD:       1.8, // Table cell content inset (+0.3mm)
  // [Improvement 41] Narrative left margin rule offset — positions
  // the decorative vertical rule 3mm from the left edge of the
  // narrative tint area so text doesn't sit right on the rule.
  NARRATIVE_RULE_OFFSET: 3,  // Left-margin rule offset from content edge
  // [Improvement 42] Image grid gap — spacing between images in
  // multi-image layouts (attachment grids, mugshot arrays).
  IMAGE_GRID_GAP:       2,   // Gap between images in grid layout
  // [Improvement 43] Double-rule section gap — extra spacing after
  // a double-rule divider before the next section starts.
  DOUBLE_RULE_GAP:      2.5, // Gap after double-rule divider
} as const;

// ── Layout Tokens ────────────────────────────────────────────

export const LAYOUT = {
  PAGE_MARGIN:       10,     // Tighter margins for max content area
  // [Improvement 44] Header bar taller to accommodate 13.5pt agency
  // name + 7pt subheader + meta line + priority badge without
  // vertical cramping.
  HEADER_HEIGHT:     17,     // Header bar (+1mm)
  // [Improvement 45] Footer area slightly taller for the double-line
  // layout (provenance sub-row + main footer row).
  FOOTER_HEIGHT:     8,      // Footer (+1mm)
  HEADER_TOP:        5,      // Y-start of header bar
  CLASSIF_BAR_H:     4.5,    // Classification bar height
  SEAL_SIZE:         13,     // Compact logo
  ACCENT_STRIP_H:    0.8,    // Thin accent strip below header
  CASE_BOX_W:        42,     // Case number box width
  LINE_HEIGHT:       2.8,    // Base line height for wrapped text
  DIAGRAM_GRID_STEP: 10,     // Grid spacing in accident diagram
  SIDEBAR_TAB_W:     18,     // Sidebar tab width
  MOBILE_PRINTER_TOP_OFFSET: 6,
  // [Improvement 46] Image thumbnail size for inline image previews
  // in attachment listings (shows a small preview next to filename).
  IMAGE_THUMB_SIZE:  12,     // Inline image thumbnail (mm)
  // [Improvement 47] Maximum narrative tint height per page — caps
  // the background tint rectangle so it doesn't extend past content.
  MAX_NARRATIVE_TINT: 240,   // Max tint height before page break (mm)
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

// [Improvement 48] One-fifth width helper for 5-column layouts
// (used by geographic strip: AREA | SECTOR | ZONE | BEAT | CODE).
/** One-fifth width for 5-column layouts */
export function getFifthWidth(doc: jsPDF): number {
  return (getContentWidth(doc) - 2 * SPACING.CONTENT_INSET - 4 * SPACING.SM) / 5;
}

// [Improvement 49] Remaining page height calculator — tells callers
// how much vertical space remains before a page break is needed.
/** Remaining usable vertical space on the current page (mm). */
export function getRemainingPageHeight(doc: jsPDF, currentY: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  const bottomReserve = LAYOUT.FOOTER_HEIGHT + 15; // footer + barcode clearance
  return Math.max(0, pageH - currentY - bottomReserve);
}

// [Improvement 50] Content area bottom Y — the lowest Y coordinate
// where content can be placed without overlapping the footer/barcode.
/** Bottom-most Y for content placement on the current page. */
export function getContentBottomY(doc: jsPDF): number {
  return doc.internal.pageSize.getHeight() - LAYOUT.FOOTER_HEIGHT - 15;
}

// ── NIBRS Grid Layout Helpers ─────────────────────────────────
