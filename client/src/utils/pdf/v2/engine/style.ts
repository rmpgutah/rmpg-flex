// Spillman Flex / Motorola Solutions visual tokens — LOW INK DESIGN.
// All sizes in jsPDF's mm/pt mixed unit space (font sizes are pt;
// rule weights are pt; spacing is mm). Single source of truth so
// future visual tweaks land in one file.
//
// 2026-06 upgrades:
//   - Reduced header rule thickness (ink savings)
//   - Section headers: outline-only (no filled bar)
//   - Thinner field underlines
//   - Reduced table header band height
//   - Lighter zebra row tint

export const TYPOGRAPHY = {
  formTitle:     { size: 14, weight: 'bold' as const },
  agencyName:    { size: 11, weight: 'bold' as const },
  agencySubline: { size: 8,  weight: 'normal' as const },
  formMeta:      { size: 7,  weight: 'normal' as const },
  sectionHeader: { size: 9,  weight: 'bold' as const },
  fieldLabel:    { size: 7,  weight: 'bold' as const },
  fieldValue:    { size: 9,  weight: 'normal' as const },
  narrativeBody: { size: 9,  weight: 'normal' as const },
  tableHeader:   { size: 8,  weight: 'bold' as const },
  tableBody:     { size: 8,  weight: 'normal' as const },
  footerText:    { size: 7,  weight: 'normal' as const },
  pageNumber:    { size: 7,  weight: 'bold' as const },
  watermark:     { size: 60, weight: 'bold' as const },
  // New: numbered section prefix (e.g. "1.", "2.")
  sectionNumber: { size: 8,  weight: 'bold' as const },
} as const;

export const RULE_WEIGHTS = {
  headerThick:     1.0,  // top of header, above agency name (reduced from 1.5 — ink savings)
  headerThin:      0.3,  // bottom of header, below form-meta line (reduced from 0.5)
  sectionRule:     0.3,  // under each section header (reduced from 0.5)
  fieldUnderline:  0.3,  // under each field value (reduced from 0.5 — still visible, less ink)
  tableBorder:     0.3,  // table cell borders (reduced from 0.5)
  tableHeaderBand: 3,    // height in pt of black header band on tables (reduced from 4)
  footerRule:      0.3,  // above footer (reduced from 0.5)
} as const;

export const SPACING = {
  pageMarginTop:     14, // mm
  pageMarginBottom:  18,
  pageMarginLeft:    10,
  pageMarginRight:   10,
  headerBlockHeight: 22,
  sectionGap:        4,
  fieldRowHeight:    9,
  cellPaddingY:      2,
  cellPaddingX:      3,
} as const;

export const AGENCY = {
  name:     'ROCKY MOUNTAIN PROTECTIVE GROUP',
  location: 'SALT LAKE CITY, UTAH',
} as const;

export const FOOTER_TEXT = {
  classification: 'PROPERTY OF ROCKY MOUNTAIN PROTECTIVE GROUP — LAW ENFORCEMENT SENSITIVE',
} as const;

export const TONES = {
  // Pure black ink only, PLUS two restrained brand accents (2026-07 upgrade —
  // approved to replace the prior zero-color rule for section headers, table
  // header bands, and the new badge/severity-meter/cross-ref-chip primitives).
  // Body text, field values, table borders, and classification banners
  // (LES/CUI/FOUO/etc.) stay pure black/gray — this is an accent, not a
  // repaint.
  zebraRow:    '#F8F8F8',  // 3% gray for alternating table rows (reduced from #F5F5F5 — ink savings)
  watermark:   '#ECECEC',  // 8% black for blank-form / draft overlays (reduced from #E6E6E6)
  accentSteel: '#2c4256',  // app's --rmpg-700 night token — header rules, section rules, table header bands
  accentGold:  '#d4a017',  // brand gold — flagged/priority emphasis only (mirrors live-app usage)
} as const;

/** RGB triples for the two accents, for callers using doc.setFillColor/setDrawColor/setTextColor(r,g,b) directly. */
export const TONES_RGB = {
  accentSteel: [44, 66, 86] as const,
  accentGold:  [212, 160, 23] as const,
} as const;
