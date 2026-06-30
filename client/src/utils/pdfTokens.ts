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
export { formatEnumValue } from './formatters';

// ── Color Tokens (RGB tuples) ────────────────────────────────

export type RGBColor = readonly [number, number, number];

export const COLOR = {
  // Text hierarchy
  TEXT_PRIMARY:    [0, 0, 0]        as const,  // Courier field values
  TEXT_SECONDARY:  [84, 84, 84]     as const,  // Helvetica labels (#545454 — neutralized 2026-05-30: the value had silently drifted to blue-slate [74,85,104], violating the zero-blue rule + contradicting this very comment)
  TEXT_TERTIARY:   [100, 100, 100]  as const,  // Placeholders, sub-labels
  TEXT_INVERTED:   [255, 255, 255]  as const,  // White on dark backgrounds — PRIMARY headers/titles
  TEXT_SUBHEAD_INVERTED: [184, 184, 184] as const,  // #b8b8b8 light-medium grey — SUB-HEADINGS on dark header bars (descriptor/subtitle/labels); legible against BG_SECTION_HDR while staying clearly secondary to the white title
  TEXT_MUTED:      [140, 140, 140]  as const,  // Form number, report date
  TEXT_CAPTION:    [120, 120, 120]  as const,  // Image captions, provenance labels
  TEXT_PLACEHOLDER: [180, 180, 180] as const,  // Empty state, placeholder text

  // Borders — clean, professional lines
  // Border palette — darkened 2026-05-05 design-definition pass.
  // The previous values produced a soft, government-form-faded look;
  // sharper, darker rule colors give the report the crisp visual
  // structure of a real PD form where every cell is bounded by a
  // visible line. Field bodies stay white; only the rule colors
  // change.
  // Neutralized 2026-05-30: every border value carried a blue cast (B channel
  // 20-30 above R/G — e.g. [80,92,110], [140,148,162]) which read as cool slate
  // against the white field bodies and violated the zero-blue rule. Each is now
  // a luminance-matched neutral gray (R=G=B at the same perceived brightness)
  // so the form's line structure is visually identical minus the blue tint.
  BORDER_FIELD:    [90, 90, 90]     as const,  // Field box borders
  BORDER_TABLE:    [122, 122, 122]  as const,  // Row separator lines
  BORDER_COLUMN:   [112, 112, 112]  as const,  // Vertical column separators
  BORDER_OUTER:    [44, 44, 44]     as const,  // Table outer border
  BORDER_SECTION:  [55, 55, 55]     as const,  // Section outline
  BORDER_FIELD_RULE: [148, 148, 148] as const, // Field underline rule
  BORDER_DOUBLE_RULE: [80, 80, 80]   as const,  // Double-rule divider lines

  // Backgrounds — page stays white; structural elements (headers,
  // banners) deepen to true charcoal for strong contrast against
  // white field bodies (2026-05-05 darker-shading pass).
  // Neutralized 2026-05-30: the header / subheader / table-header fills were
  // blue-slate ([44,50,64], [54,60,76], [45,55,72] all have B well above R/G),
  // so the big agency header bar, the "FORM PS-XXX" subheader strip, and every
  // section/column header read with a cool blue tint — the exact thing the
  // zero-blue rule forbids. Remapped to luminance-matched neutral charcoals so
  // the headers stay strong/dark but are true gray. Zebra + tint backgrounds
  // also de-blued ([242,242,246]→[243,243,243], [248,248,252]→[249,249,249]).
  BG_ZEBRA:        [243, 243, 243]  as const,  // Even-row table shading
  BG_SECTION_HDR: [51, 51, 51]    as const,  // #333 dark grey — section/hero header bars. Softened from solid black 2026-06-16 (white titles stay legible; sub-headings use TEXT_SUBHEAD_INVERTED)
  BG_TABLE_HDR:    [51, 51, 51]    as const,  // #333 dark grey — table column-header band. Matched to BG_SECTION_HDR 2026-06-16 for a uniform dark-grey header treatment
  BG_SECTION_TINT: [255, 255, 255]  as const,  // Pure white — no background tint (removed 2026-05-30)
  BG_TABLE_HDR_LIGHT: [224, 224, 224] as const, // Nested table header (light gray)
  TEXT_TABLE_HDR_LIGHT: [54, 54, 54]  as const,  // Dark gray text on light hdr

  // Brand accent — pivoted to grayscale 2026-05-04 (user request).
  // Token name retained for backwards compatibility with existing call
  // sites; the underlying value is now a dark charcoal so every site
  // that previously rendered a gold accent (agency header strip,
  // quick-reference banner left rule, district bar accent, notes entry
  // left rule, horizontal section dividers) automatically becomes
  // grayscale via this single point of change.
  ACCENT_GOLD:     [0, 0, 0]       as const,  // Pure black accent (Spillman convention, 2026-05-30)

  // Financial — neutralized 2026-05-30: credit green and debit red converted to
  // neutral grays so financial indicators carry zero color splash. Distinct
  // luminance levels preserve the semantic difference without hue.
  AMOUNT_CREDIT:   [60, 60, 60]     as const,
  AMOUNT_DEBIT:    [90, 90, 90]     as const,

  // Watermark
  WATERMARK:       [120, 120, 120]   as const,
  // [Improvement 26] VOID watermark — distinct red for voided documents
  // (citations, warrants) so they're immediately distinguishable from
  // CONFIDENTIAL (gray) and DRAFT (red with border).
  WATERMARK_VOID:  [200, 30, 30]     as const,  // Red for VOID watermark

  // Caution / Warning — neutralized 2026-05-30: all caution highlights and
  // subject-safety flags are now luminance-distinguished grays. The semantic
  // weight (armed vs medical vs gang) is conveyed by the label text alone,
  // not by red/orange/purple/blue/green hues.
  CAUTION_BG:      [243, 243, 243]  as const,  // Neutral light gray (was amber)
  CAUTION_ACCENT:  [90, 90, 90]     as const,  // Neutral mid-gray (was amber accent)
  CAUTION_TEXT:    [60, 60, 60]     as const,  // Dark gray warning text (was amber)
  FLAG_ARMED:      [55, 55, 55]     as const,  // Dark charcoal (was red)
  FLAG_WARRANT:    [75, 75, 75]     as const,  // Medium-dark (was orange)
  FLAG_GANG:       [90, 90, 90]     as const,  // Mid-gray (was purple)
  FLAG_MENTAL:     [105, 105, 105]  as const,  // Medium gray (was blue)
  FLAG_MEDICAL:    [120, 120, 120]  as const,  // Lighter gray (was green)
  FLAG_DEFAULT:    [84, 84, 84]     as const,  // Generic flag (unchanged)

  // NIBRS Grid Form — sidebar tabs + dense cells
  BG_SIDEBAR_TAB:      [0, 0, 0]        as const,  // Black sidebar tab (Spillman convention, 2026-05-30)
  BG_FORM_CELL_LABEL:  [241, 241, 241]  as const,  // Light gray label strip inside cell (de-blued 2026-05-30)
  BORDER_FORM_GRID:    [60, 60, 60]     as const,  // Dark grid lines (shared borders)

  // Police-form furniture (added 2026-04-17 for enhanced LE styling)
  RULE_GOLD:           [80, 80, 80]     as const,  // Dark gray accent rule (was gold; grayscale 2026-05-04)
  RULE_STRONG:         [30, 30, 30]     as const,  // Heavy black rule for top/bottom
  BATES_STAMP:         [70, 70, 70]     as const,  // Neutral gray (was burgundy; neutralized 2026-05-30)
  BARCODE_BAR:         [0, 0, 0]        as const,  // Code 39 black bars
  BARCODE_BG:          [255, 255, 255]  as const,  // Code 39 white space
  BARCODE_STRIP_BG:    [250, 250, 250]  as const,  // Light strip background for scan row
  BARCODE_STRIP_RULE:  [182, 182, 182]  as const,  // Neutralized 2026-05-30 (was carrying a blue cast)
  CERT_BG:             [248, 248, 248]  as const,  // Light gray cert bg (was ivory; neutralized 2026-05-30)
  CERT_RULE:           [130, 130, 130]  as const,  // Neutral gray cert rule (was olive; neutralized 2026-05-30)
  MUGSHOT_RULE:        [60, 60, 60]     as const,  // Dark frame around arrest photo
  DIVIDER_RULE:        [200, 200, 200]  as const,  // Subtle divider rule above provenance
  STAMP_BG:            [248, 248, 248]  as const,  // Seal/stamp area background tint

  // Priority bar palette (separate from PRIORITY_COLORS in pdfGenerator.ts —
  // these are the tokenized fills used by drawPriorityBar helper)
  // Priority bar palette — neutralized 2026-05-30: red/orange/yellow/green
  // hues replaced by a luminance gradient (darkest → lightest) so the urgency
  // level is still visually distinguishable on grayscale printouts.
  PRIO_1_BG:           [50, 50, 50]     as const,  // Darkest (was red)
  PRIO_2_BG:           [75, 75, 75]     as const,  // Medium-dark (was orange)
  PRIO_3_BG:           [100, 100, 100]  as const,  // Medium (was yellow)
  PRIO_4_BG:           [125, 125, 125]  as const,  // Lightest (was green)
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
  // Classification banner colors — neutralized 2026-05-30: all hue-based
  // distinctions (LES red, CUI purple, FOUO amber, UNCLAS green, CONFIDENTIAL
  // dark red, SEALED gold text) replaced with luminance-graded grays. CJIS
  // markings remain visually distinguishable via bar shade + label text.
  LES:          { bg: [50, 50, 50],   fg: [255, 255, 255], label: 'LAW ENFORCEMENT SENSITIVE // CJIS' },
  CUI:          { bg: [65, 65, 65],   fg: [255, 255, 255], label: 'CONTROLLED UNCLASSIFIED INFORMATION // LE' },
  FOUO:         { bg: [80, 80, 80],   fg: [255, 255, 255], label: 'FOR OFFICIAL USE ONLY' },
  UNCLAS:       { bg: [100, 100, 100], fg: [255, 255, 255], label: 'UNCLASSIFIED' },
  CONFIDENTIAL: { bg: [40, 40, 40],   fg: [255, 255, 255], label: 'CONFIDENTIAL // NOFORN' },
  SEALED:       { bg: [30, 30, 30],   fg: [200, 200, 200], label: 'SEALED BY COURT ORDER -- DO NOT DISSEMINATE' },
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
  SIZE_SECTION_TITLE:     9,     // Section header text (all-caps, Helvetica Bold 9pt — bumped 2026-05-30 for Spillman/LexisNexis readability)
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
  SIZE_CASE_NUMBER:       8.5,   // Case number value (courier bold)
  SIZE_FORM_CELL_LABEL:   6,     // Form cell label (same as field label)
  SIZE_FORM_CELL_VALUE:   8.5,   // Form cell value (same as field value)
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
  // Line widths — reduced 2026-06-28 for low-ink printing.
  SECTION_OUTER:    0.3,   // Border around sections
  FIELD:            0.3,   // Field box borders
  TABLE_OUTER:      0.3,   // Outer border of tables
  TABLE_ROW:        0.3,   // Row separators
  TABLE_COLUMN:     0.3,   // Column separators
  CHECKBOX:         0.3,   // Checkbox square border
  CHECK_MARK:       0.3,   // Check mark stroke
  SIGNATURE_LINE:   0.3,   // Signature line
  ACCENT_HEADER:    0.3,   // Accent line below header
  ACCENT_FOOTER:    0.3,   // Accent line above footer
  ACCENT_SECTION:   0,     // Section header left-accent strip REMOVED 2026-05-30 (was 2.0). Zero-width = no left highlight anywhere; section-header bars span full width and titles start at the left margin across all PDF generators.
  FIELD_UNDERLINE:  0.3,   // Field underline rule
  CASE_BOX:         0.3,   // White border inside case number box
  BANNER:           0.3,   // Banner borders
  DIAGRAM_GRID:     0.1,   // Accident diagram grid lines
  FORM_CELL:        0.25,  // Form cell borders (subtle grid)
  SIDEBAR_TAB:      0.25,  // Sidebar tab border
  FORM_GRID_OUTER:  0.3,   // Bold outer border around form grid
  CLASSIFICATION:   0,     // Classification bars are filled, no stroke
  CLASSIFICATION_RULE: 0.3, // Gold rule under top classification bar
  CERT_BOX:         0.3,   // Officer certification block border
  CAUTION_STRIP:    0.3,   // Caution strip outer border
  PRIORITY_BAR:     0.3,   // Priority bar outer border
  TIMELINE_CELL:    0.25,  // Dispatch timeline cell dividers
  TIMELINE_OUTER:   0.3,   // Dispatch timeline outer border
  COC_ROW:          0.25,  // Chain of custody row divider
  COC_OUTER:        0.5,   // Chain of custody outer border
  BARCODE_STRIP:    0.3,   // Barcode scan strip border
  MUGSHOT_FRAME:    0.3,   // Mugshot frame
  NARRATIVE_RULE:   0.3,   // Left-margin vertical rule on narrative
  // [Improvement 32] Double-rule — two thin lines 0.8mm apart used as
  // major section dividers (e.g. between header chrome and body).
  DOUBLE_RULE:      0.25,  // Individual line of a double-rule pair
  DOUBLE_RULE_GAP:  0.8,   // Gap between double-rule lines (mm)
  // [Improvement 33] Image frame border — slightly heavier than field
  // borders so embedded photos have a distinct picture-frame feel.
  IMAGE_FRAME:      0.3,   // Image/photo frame border
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
  SECTION_HEADER_H:   4.5,   // Section header bar height (readable with accent strip)
  SECTION_GAP:        0.6,   // Gap between sections (condensed 2026-05-31: 1.0 → 0.6)
  // Breathing room between section header bar and first content row.
  // 1.2mm keeps the first label clear of the bar without hugging while
  // keeping multi-section forms compact (condensed 2026-05-31: 2 → 1.2).
  SECTION_CONTENT_PAD: 1.2,
  SECTION_BOTTOM_PAD:  0.5,  // Padding inside section before bottom border

  FIELD_ROW_HEIGHT:   2.0,   // Value area height (condensed 2026-05-31: 2.8 → 2.0)
  FIELD_ROW_ADVANCE:  2.0,   // Y-advance after field row (condensed 2026-05-31: 2.8 → 2.0)

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
