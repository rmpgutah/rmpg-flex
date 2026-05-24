// Spillman Flex / Motorola Solutions visual tokens.
// All sizes in jsPDF's mm/pt mixed unit space (font sizes are pt;
// rule weights are pt; spacing is mm). Single source of truth so
// future visual tweaks land in one file.

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
} as const;

export const RULE_WEIGHTS = {
  headerThick:     1.5,  // top of header, above agency name
  headerThin:      0.5,  // bottom of header, below form-meta line
  sectionRule:     0.5,  // under each section header
  fieldUnderline:  0.5,  // under each field value (form-fill cue)
  tableBorder:     0.5,  // table cell borders
  tableHeaderBand: 4,    // height in pt of black header band on tables
  footerRule:      0.5,  // above footer
} as const;

export const SPACING = {
  pageMarginTop:     14, // mm
  pageMarginBottom:  18,
  pageMarginLeft:    10,
  pageMarginRight:   10,
  headerBlockHeight: 22,
  sectionGap:        3,
  fieldRowHeight:    8,
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
  // Pure black ink only. The two non-pure-black tones below are the
  // ONLY exceptions and they render correctly on B&W laser printers.
  zebraRow:  '#F5F5F5',  // 5% gray for alternating table rows
  watermark: '#E6E6E6',  // 10% black for blank-form / draft overlays
} as const;
