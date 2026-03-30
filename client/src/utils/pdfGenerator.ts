// ============================================================
// RMPG Flex — PDF Report Generator (v3 — Design Token Remodel)
// Professional law-enforcement form layouts using jsPDF
// Centralized design tokens, auto-sizing sections, unified grid
// Case Number Format: RKY26-#####-CODE
// Build: __BUILD_TIME__ (cache-bust)
// ============================================================

// Build timestamp for cache busting — changes on every build
const _buildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
void _buildTime;

import jsPDF from 'jspdf';
import { getTypeCode, formatIncidentType, type PdfReportType } from './caseNumbers';
import { loadSealBase64, loadLogoDarkBase64, FORM_NUMBERS, FORM_REVISION } from './pdfAssets';
import {
  COLOR, FONT, BORDER, SPACING, LAYOUT,
  getContentWidth, getHalfWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth, getThirdWidth, getQuarterWidth,
  getGridStartX, getGridContentWidth,
} from './pdfTokens';
import {
  drawFormSection, drawFormGrid, drawFormCell, drawFormRow,
  drawSideTab, drawCheckboxGrid, drawCodeReferenceTable, drawNibrsHeader,
  NIBRS_PROPERTY_CODES, NIBRS_WEAPON_CODES, NIBRS_LOCATION_CODES,
  type FormCell, type FormRow, type CheckboxItem, type SideTabConfig,
} from './pdfFormHelpers';

// ── Branding Interface (matches Admin BrandingConfig) ────────

export interface PdfBranding {
  report_header_text: string;
  report_subheader_text: string;
  primary_color: string;     // hex — used for case-number box & accents
  accent_color: string;      // hex — used for separator lines & subtitles
  header_bg_color: string;   // hex — used for header/footer bars
}

export const DEFAULT_PDF_BRANDING: PdfBranding = {
  report_header_text: 'RMPG SECURITY SERVICES',
  report_subheader_text: 'PRIVATE SECURITY',
  primary_color: '#1a5a9e',
  accent_color: '#8a8e9c',
  header_bg_color: '#f0f1f4',
};

/** Fetch branding settings from admin config API (gracefully falls back to defaults) */
export async function fetchPdfBranding(): Promise<PdfBranding> {
  try {
    const token = localStorage.getItem('rmpg_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/admin/config/branding', { headers });
    if (!res.ok) return { ...DEFAULT_PDF_BRANDING };
    const items = await res.json() as { config_key: string; config_value: string }[];
    const item = items.find(i => i.config_key === 'branding_settings') || items[0];
    if (!item) return { ...DEFAULT_PDF_BRANDING };
    const parsed = JSON.parse(item.config_value);
    return { ...DEFAULT_PDF_BRANDING, ...parsed };
  } catch {
    return { ...DEFAULT_PDF_BRANDING };
  }
}

// ── Re-exports for backward compatibility ────────────────────
// (recordPdfGenerator and invoicePdfGenerator import these)

export const PAGE_MARGIN = LAYOUT.PAGE_MARGIN;
export const LINE_HEIGHT = LAYOUT.LINE_HEIGHT;
export const FONT_SIZE_LABEL = FONT.SIZE_FIELD_LABEL;
export const FONT_SIZE_VALUE = FONT.SIZE_FIELD_VALUE;
export const HEADER_HEIGHT = LAYOUT.HEADER_HEIGHT;
export const FOOTER_HEIGHT = LAYOUT.FOOTER_HEIGHT;
export const GRID_BORDER_THICK = BORDER.SECTION_OUTER;
export const GRID_BORDER_THIN = BORDER.FIELD;
export const GRID_CELL_HEIGHT = SPACING.FIELD_ROW_HEIGHT;
export const CLASSIFICATION_BAR_HEIGHT = LAYOUT.CLASSIF_BAR_H;

// Priority color mapping
export const PRIORITY_COLORS: Record<string, { bg: [number, number, number]; text: [number, number, number]; label: string }> = {
  critical: { bg: [220, 38, 38], text: [255, 255, 255], label: 'PRIORITY: CRITICAL' },
  high: { bg: [220, 80, 20], text: [255, 255, 255], label: 'PRIORITY: HIGH' },
  medium: { bg: [212, 160, 23], text: [0, 0, 0], label: 'PRIORITY: MEDIUM' },
  low: { bg: [60, 130, 80], text: [255, 255, 255], label: 'PRIORITY: LOW' },
  routine: { bg: [80, 120, 180], text: [255, 255, 255], label: 'PRIORITY: ROUTINE' },
};

// Generation timestamp captured once per report
export let generationTimestamp = '';
export function setGenerationTimestamp(ts: string) { generationTimestamp = ts; }

// Active branding (set before each report generation)
let activeBranding: PdfBranding = { ...DEFAULT_PDF_BRANDING };
export function setActiveBranding(b: PdfBranding) { activeBranding = b; }
export function getActiveBranding(): PdfBranding { return activeBranding; }

// Section counter removed — section headers now display clean titles without numbering

/**
 * Sanitize Unicode characters that jsPDF's built-in Courier/Helvetica can't render.
 * These fonts only support Latin-1 (ISO-8859-1). Unicode arrows, em-dashes, curly quotes,
 * etc. have zero width in font metrics, causing justification to spread text wildly.
 */
export function sanitizePdfText(text: string): string {
  if (!text) return text;
  return text
    .replace(/\u2192/g, '->')    // → right arrow
    .replace(/\u2190/g, '<-')    // ← left arrow
    .replace(/\u2194/g, '<->')   // ↔ left-right arrow
    .replace(/\u2014/g, '--')    // — em dash
    .replace(/\u2013/g, '-')     // – en dash
    .replace(/\u2018/g, "'")     // ' left single quote
    .replace(/\u2019/g, "'")     // ' right single quote
    .replace(/\u201C/g, '"')     // " left double quote
    .replace(/\u201D/g, '"')     // " right double quote
    .replace(/\u2026/g, '...')   // … ellipsis
    .replace(/\u2022/g, '*')     // • bullet
    .replace(/\u00A0/g, ' ')     // non-breaking space
    .replace(/\u200B/g, '')      // zero-width space
    .replace(/\u00B7/g, '.')     // · middle dot
    .replace(/\u2713/g, '[X]')   // ✓ check mark
    .replace(/\u2717/g, '[ ]')   // ✗ cross mark
    .replace(/\u26A0/g, '[!]')   // ⚠ warning
    .replace(/[^\x00-\xFF]/g, '?'); // Replace any remaining non-Latin-1 chars
}

/**
 * Word-aware text wrapper — splits on spaces first, only breaking within
 * words as a last resort. Unlike jsPDF's splitTextToSize which can break
 * mid-word with Courier, this respects word boundaries.
 */
export function wordWrapText(doc: jsPDF, text: string, maxWidth: number): string[] {
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let currentLine = '';
  for (const word of words) {
    const testLine = currentLine + word;
    if (doc.getTextWidth(testLine) > maxWidth && currentLine.trim()) {
      lines.push(currentLine.trimEnd());
      currentLine = word.trimStart();
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trimEnd());
  return lines.length ? lines : [''];
}

// Cached images (loaded once per session)
let cachedSeal: string | null = null;
let cachedLogoDark: string | null = null;

// Active form key for footer form numbers
let activeFormKey = '';
export function setActiveFormKey(key: string) { activeFormKey = key; }

// Active case number for continuation headers
let activeCaseNumber = '';
export function setActiveCaseNumber(cn: string) { activeCaseNumber = cn; }

/** Load seal + logo images for PDF embedding. Call before generating PDFs. */
export async function loadPdfAssets(): Promise<void> {
  if (cachedSeal === null) {
    cachedSeal = await loadSealBase64() || '';
  }
  if (cachedLogoDark === null) {
    cachedLogoDark = await loadLogoDarkBase64() || '';
  }
}

/** Access cached dark logo (for record generators) */
export function getCachedLogoDark(): string | null {
  return cachedLogoDark || null;
}

// ── Base Helpers ─────────────────────────────────────────────

/** Parse hex color to RGB tuple */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) || 48,
    parseInt(h.substring(2, 4), 16) || 48,
    parseInt(h.substring(4, 6), 16) || 48,
  ];
}

export function addConfidentialWatermark(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // @ts-expect-error jsPDF GState — visible on both white and dark backgrounds
  doc.setGState(new doc.GState({ opacity: 0.06 }));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_WATERMARK_LARGE);

  const cx = pageWidth / 2;
  const cy = pageHeight / 2;

  // Dark gray text — visible on white paper
  doc.setTextColor(80, 80, 80);
  doc.text('CONFIDENTIAL', cx, cy, { align: 'center' });

  // White text slightly offset — visible over dark section headers
  doc.setTextColor(255, 255, 255);
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 0.15 }));
  doc.text('CONFIDENTIAL', cx, cy, { align: 'center' });

  // Reset opacity to full
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));
}

// Feature 34: Add "DRAFT" watermark to unapproved reports
export function addDraftWatermark(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.saveGraphicsState();
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 0.12 }));
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(220, 38, 38); // Red

  const cx = pageWidth / 2;
  const cy = pageHeight / 2;
  doc.setFontSize(72);
  doc.text('DRAFT', cx, cy, { align: 'center', angle: 45 });

  // Add border warning
  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(2);
  doc.rect(10, 10, pageWidth - 20, pageHeight - 20);

  doc.restoreGraphicsState();
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));
}

export function addClassificationBar(doc: jsPDF, priority: string, yStart: number): number {
  const cw = getContentWidth(doc);
  const prio = PRIORITY_COLORS[priority?.toLowerCase()] || PRIORITY_COLORS['routine'];

  doc.setFillColor(prio.bg[0], prio.bg[1], prio.bg[2]);
  doc.rect(LAYOUT.PAGE_MARGIN, yStart, cw, LAYOUT.CLASSIF_BAR_H, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_CLASSIF_BAR);
  doc.setTextColor(prio.text[0], prio.text[1], prio.text[2]);
  doc.text(prio.label, doc.internal.pageSize.getWidth() / 2, yStart + 4.2, { align: 'center' });

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return yStart + LAYOUT.CLASSIF_BAR_H + SPACING.SM;
}

/**
 * Compact header: agency name, report type, case box, priority badge.
 * Priority is displayed as a small badge inside the header (no separate bar).
 */
export function addReportHeader(
  doc: jsPDF,
  caseNumber: string,
  reportType: string,
  priority: string,
  agencyName?: string,
  headerOptions?: { caseBoxLabel?: string; useLogo?: boolean },
): number {
  const brand = activeBranding;
  const pageWidth = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const headerBg = hexToRgb(brand.header_bg_color);
  const primaryRgb = hexToRgb(brand.primary_color);
  const caseBoxLabel = headerOptions?.caseBoxLabel || 'CASE NUMBER';
  const useLogo = headerOptions?.useLogo ?? true;

  // Store case number for continuation headers
  activeCaseNumber = caseNumber;

  // Ensure full opacity (safety reset after watermark GState)
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  const accentRgb = hexToRgb(brand.accent_color);

  // Detect if header background is light or dark to choose text colors
  const bgLuminance = (headerBg[0] * 0.299 + headerBg[1] * 0.587 + headerBg[2] * 0.114);
  const isLightBg = bgLuminance > 140;
  const headerTextColor: [number, number, number] = isLightBg ? [30, 30, 35] : [255, 255, 255];
  const headerMetaColor: [number, number, number] = isLightBg ? [100, 100, 110] : [150, 150, 150];
  const subheaderColor: [number, number, number] = isLightBg ? primaryRgb : [accentRgb[0], accentRgb[1], accentRgb[2]];

  // ── Header background bar (no top outline — clean edge) ─
  doc.setFillColor(headerBg[0], headerBg[1], headerBg[2]);
  doc.rect(LAYOUT.PAGE_MARGIN, LAYOUT.HEADER_TOP, cw, LAYOUT.HEADER_HEIGHT, 'F');

  // ── Seal / Logo image (left) ───────────────────────────
  const sealX = LAYOUT.PAGE_MARGIN + SPACING.SM + 0.5;
  const sealY = LAYOUT.HEADER_TOP + (LAYOUT.HEADER_HEIGHT - LAYOUT.SEAL_SIZE) / 2;
  let textStartX = LAYOUT.PAGE_MARGIN + SPACING.XL;

  const imageToUse = useLogo && cachedLogoDark ? cachedLogoDark : cachedSeal;

  if (imageToUse) {
    try {
      doc.addImage(imageToUse, 'PNG', sealX, sealY, LAYOUT.SEAL_SIZE, LAYOUT.SEAL_SIZE);
      textStartX = sealX + LAYOUT.SEAL_SIZE + SPACING.MD;
    } catch {
      textStartX = LAYOUT.PAGE_MARGIN + SPACING.XL;
    }
  }

  // ── Line 1: Agency name ────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_HEADER_TITLE);
  doc.setTextColor(headerTextColor[0], headerTextColor[1], headerTextColor[2]);
  doc.text(agencyName || brand.report_header_text, textStartX, LAYOUT.HEADER_TOP + 6.5);

  // ── Line 2: Subheader ──────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_SUBHEADER);
  doc.setTextColor(subheaderColor[0], subheaderColor[1], subheaderColor[2]);
  doc.text(brand.report_subheader_text, textStartX, LAYOUT.HEADER_TOP + 11);

  // ── Line 3: Report type | form# | rev | date ──────────
  const formNum = FORM_NUMBERS[activeFormKey] || '';
  const reportDate = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const metaParts = [reportType.toUpperCase()];
  if (formNum) metaParts.push(formNum);
  metaParts.push(FORM_REVISION);
  metaParts.push(reportDate);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SMALL_META);
  doc.setTextColor(headerMetaColor[0], headerMetaColor[1], headerMetaColor[2]);
  doc.text(metaParts.join('  |  '), textStartX, LAYOUT.HEADER_TOP + 15);

  // ── Priority badge (inline, "P4 - Low" format) ─────────
  const prioKey = priority?.toLowerCase() || '';
  const prio = PRIORITY_COLORS[prioKey];
  if (prio) {
    // Map priority keys → short labels: P1 - Critical, P2 - Urgent, etc.
    const prioShortNames: Record<string, string> = {
      critical: 'P1 - Critical', high: 'P2 - High',
      medium: 'P3 - Medium', low: 'P4 - Low', routine: 'P5 - Routine',
    };
    // Also handle P1/P2/P3/P4 keys directly
    const pKey = priority?.toUpperCase() || '';
    const prioLabelText = prioShortNames[prioKey]
      || (pKey === 'P1' ? 'P1 - Emergency' : pKey === 'P2' ? 'P2 - Urgent'
        : pKey === 'P3' ? 'P3 - Routine' : pKey === 'P4' ? 'P4 - Low' : prio.label.replace('PRIORITY: ', ''));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5);
    const prioW = doc.getTextWidth(prioLabelText) + 4;
    const prioX = textStartX;
    const prioY = LAYOUT.HEADER_TOP + 16.5;
    doc.setFillColor(prio.bg[0], prio.bg[1], prio.bg[2]);
    doc.roundedRect(prioX, prioY, prioW, 3, 0.5, 0.5, 'F');
    doc.setTextColor(prio.text[0], prio.text[1], prio.text[2]);
    doc.text(prioLabelText, prioX + prioW / 2, prioY + 2.2, { align: 'center' });
  }

  // ── Case number box (right) ────────────────────────────
  const caseBoxH = LAYOUT.HEADER_HEIGHT - 2;
  const caseBoxX = pageWidth - LAYOUT.PAGE_MARGIN - LAYOUT.CASE_BOX_W - SPACING.SM;
  const caseBoxY = LAYOUT.HEADER_TOP + 1;

  doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.rect(caseBoxX, caseBoxY, LAYOUT.CASE_BOX_W, caseBoxH, 'F');

  // Luminance check: use dark text on light primary color, white on dark
  const primaryLum = primaryRgb[0] * 0.299 + primaryRgb[1] * 0.587 + primaryRgb[2] * 0.114;
  const caseTextColor: [number, number, number] = primaryLum > 140 ? [30, 30, 35] : [255, 255, 255];

  // Label
  doc.setFontSize(FONT.SIZE_SMALL_META);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...caseTextColor);
  doc.text(caseBoxLabel, caseBoxX + LAYOUT.CASE_BOX_W / 2, caseBoxY + 5, { align: 'center' });

  // Case number value
  doc.setFontSize(FONT.SIZE_CASE_NUMBER);
  doc.setFont('courier', 'bold');
  doc.text(caseNumber, caseBoxX + LAYOUT.CASE_BOX_W / 2, caseBoxY + 12, { align: 'center' });

  // ── Thin accent line below header (primary color only) ─
  const stripY = LAYOUT.HEADER_TOP + LAYOUT.HEADER_HEIGHT;
  doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.rect(LAYOUT.PAGE_MARGIN, stripY, cw, LAYOUT.ACCENT_STRIP_H, 'F');

  // ── Reset drawing state ────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);

  return stripY + LAYOUT.ACCENT_STRIP_H + SPACING.SM;
}

/**
 * Auto-sizing section with clean header bar (no numbering, no accent stripes).
 * Call `closeAutoSection(doc, sectionStartY, contentEndY)` when done.
 */
export function openAutoSection(doc: jsPDF, title: string, y: number): { contentY: number; sectionY: number; sectionPage: number } {
  const cw = getContentWidth(doc);

  // Ensure full opacity (safety reset after watermark GState)
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  // Section header bar (dark slate) with white text, left-justified
  doc.setFillColor(...COLOR.BG_SECTION_HDR);
  doc.rect(LAYOUT.PAGE_MARGIN, y, cw, SPACING.SECTION_HEADER_H, 'F');
  // Clean border around header
  doc.setDrawColor(...COLOR.BORDER_SECTION);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.rect(LAYOUT.PAGE_MARGIN, y, cw, SPACING.SECTION_HEADER_H);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_SECTION_TITLE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  // Vertically centered in header bar: baseline ≈ top + (barH + capH) / 2
  const capH = FONT.SIZE_SECTION_TITLE * 0.35;
  const sectionTextY = y + (SPACING.SECTION_HEADER_H + capH) / 2;
  doc.text(sanitizePdfText(title.toUpperCase()), LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET + 1, sectionTextY);

  // Reset text color to primary (black) — prevents white text leaking into content
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFont('helvetica', 'normal');

  // Content starts after header bar + content padding (not tight against bar)
  return { contentY: y + SPACING.SECTION_HEADER_H + SPACING.SECTION_CONTENT_PAD, sectionY: y, sectionPage: doc.getNumberOfPages() };
}

/**
 * Close an auto-sizing section — draws thin border from sectionY to contentEndY.
 * Page-break-aware: if content has spilled to a new page, draws border segments
 * per page instead of a single rectangle that would overlap.
 */
export function closeAutoSection(doc: jsPDF, sectionY: number, contentEndY: number, padding = SPACING.SECTION_BOTTOM_PAD, sectionPage?: number): number {
  const cw = getContentWidth(doc);
  const currentPage = doc.getNumberOfPages();
  const startPage = sectionPage ?? currentPage;

  if (startPage === currentPage) {
    // Same page — draw enclosing section border
    const totalHeight = (contentEndY - sectionY) + padding;
    doc.setDrawColor(...COLOR.BORDER_SECTION);
    doc.setLineWidth(BORDER.SECTION_OUTER);
    doc.rect(LAYOUT.PAGE_MARGIN, sectionY, getContentWidth(doc), totalHeight);
  } else {
    // Multi-page section — just ensure we're on the last page
    doc.setPage(currentPage);
  }

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  return contentEndY + padding + SPACING.SECTION_GAP;
}

/**
 * @deprecated Use openAutoSection/closeAutoSection instead.
 * Kept for backward compatibility — now wraps auto-section internally.
 */
export function addBoxedSection(doc: jsPDF, title: string, y: number, _height: number): number {
  const result = openAutoSection(doc, title, y);
  // NOTE: This still doesn't close the section automatically — callers must
  // handle the border manually or migrate to openAutoSection/closeAutoSection.
  return result.contentY;
}

/**
 * Modern field with floating label above a bordered value box.
 * Label sits above the box in lighter gray; box contains only the value.
 * Auto-expands height for multi-line values (up to 4 lines).
 * Shows "—" em-dash for empty/null values.
 * Returns Y position for next row.
 */
export function addFieldPair(doc: jsPDF, label: string, value: string, x: number, y: number, width: number, maxLinesOverride?: number): number {
  // @ts-expect-error jsPDF GState — ensure full opacity
  doc.setGState(new doc.GState({ opacity: 1.0 }));
  const labelH = 2.5;        // Height reserved for label above value
  const baseBoxH = 3;        // Minimum value area height
  const innerPad = 0.8;      // Horizontal padding
  const maxW = width - 2 * innerPad;
  const lineStep = FONT.SIZE_FIELD_VALUE * 0.35 + 0.2; // Y-step per extra line
  // Auto-detect long text fields: if value > 200 chars or full-width field, allow more lines
  const isLongText = (value || '').length > 200 || width > 160;
  const maxLines = maxLinesOverride ?? (isLongText ? 20 : 8);

  // Floating label above the box
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(label.toUpperCase(), x + innerPad, y + 2);

  // Determine value text and line count — Courier for values
  doc.setFont('courier', 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);

  const sanitized = sanitizePdfText(value);
  const isEmpty = !sanitized || sanitized.trim() === '';
  const displayText = isEmpty ? 'N/A' : sanitized.toUpperCase();
  const allFieldLines = isEmpty ? [displayText] : wordWrapText(doc, displayText, maxW - 1);
  const lines: string[] = allFieldLines.slice(0, maxLines);
  if (allFieldLines.length > maxLines && lines.length > 0) {
    const lastLn = lines[lines.length - 1];
    lines[lines.length - 1] = lastLn.length > 3 ? lastLn.slice(0, -3) + '...' : '...';
  }
  const extraLines = Math.max(0, lines.length - 1);
  const boxH = baseBoxH + extraLines * lineStep;

  // Page break if field won't fit on current page
  const totalFieldH = labelH + boxH + 1;
  y = checkPageBreak(doc, y, totalFieldH);

  // Value area with cell border
  const boxY = y + labelH;
  doc.setDrawColor(...COLOR.BORDER_FIELD);
  doc.setLineWidth(BORDER.FIELD);
  doc.rect(x, y, maxW, totalFieldH - 1);

  // Value text — vertically centered in box
  const valColor = isEmpty ? COLOR.TEXT_TERTIARY : COLOR.TEXT_PRIMARY;
  doc.setTextColor(valColor[0], valColor[1], valColor[2]);

  const textBlockH = lines.length * lineStep;
  const textStartY = boxY + (boxH - textBlockH) / 2 + lineStep * 0.72;
  let lineY = textStartY;
  for (const line of lines) {
    doc.text(line, x + innerPad, lineY);
    lineY += lineStep;
  }

  // Reset text color
  doc.setTextColor(...COLOR.TEXT_PRIMARY);

  return y + labelH + boxH + 0.5; // label + box + small gap
}

/**
 * Drawn checkbox (consistent cross-platform rendering).
 * Returns X position for next element.
 */
export function addCheckboxField(doc: jsPDF, label: string, checked: boolean, x: number, y: number): number {
  // @ts-expect-error jsPDF GState — ensure full opacity
  doc.setGState(new doc.GState({ opacity: 1.0 }));
  const boxSize = 3;

  if (checked) {
    // Filled dark square with white checkmark
    doc.setFillColor(40, 40, 40);
    doc.rect(x, y - 1.5, boxSize, boxSize, 'F');
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(BORDER.CHECK_MARK);
    doc.line(x + 0.5, y + 0.0, x + 1.2, y + 1.0);
    doc.line(x + 1.2, y + 1.0, x + 2.5, y - 1.0);
  } else {
    // Empty box with border
    doc.setDrawColor(...COLOR.TEXT_SECONDARY);
    doc.setLineWidth(BORDER.CHECKBOX);
    doc.rect(x, y - 1.5, boxSize, boxSize);
  }

  doc.setFont('courier', 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  const safeLabel = sanitizePdfText(label).toUpperCase();
  doc.text(safeLabel, x + boxSize + 1.5, y);

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  return x + boxSize + 1.5 + doc.getTextWidth(safeLabel) + 3;
}

/**
 * Render flags/warnings as individually spaced colored pill badges.
 * Each flag gets its own rounded rectangle with inverted text.
 * Wraps across rows when the line exceeds available width.
 * Returns final Y position.
 */
export function addFlagBadges(
  doc: jsPDF,
  flags: string[],
  x: number,
  y: number,
  maxWidth: number,
  priority?: string,
): number {
  if (!flags || flags.length === 0) return y;

  // @ts-expect-error jsPDF GState — ensure full opacity
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  const pillH = 5;          // Badge pill height
  const pillPadX = 3;       // Horizontal padding inside pill
  const pillGapX = 2;       // Gap between pills horizontally
  const pillGapY = 1.5;     // Gap between rows vertically
  const fontSize = 6;
  const cornerR = 1.2;      // Rounded corner radius

  // Flag → color mapping (red for danger, amber for warnings, gray for info)
  const flagColors: Record<string, [number, number, number]> = {
    'ARMED & DANGEROUS': [180, 20, 20],
    'VIOLENT': [180, 20, 20],
    'FLIGHT RISK': [180, 20, 20],
    'WARRANT': [180, 20, 20],
    'SEX OFFENDER': [180, 20, 20],
    'GANG MEMBER': [180, 20, 20],
    'BOLO': [200, 80, 10],
    'CAUTION': [200, 80, 10],
    'SUICIDAL': [200, 80, 10],
    'MENTAL HEALTH': [200, 80, 10],
    'DRUG USER': [200, 80, 10],
    'OFFICER SAFETY': [200, 80, 10],
    'RESTRICTED': [120, 80, 160],
  };
  const defaultColor: [number, number, number] = [70, 75, 88]; // Slate for unrecognized

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);

  let curX = x;
  let curY = y;

  for (const flag of flags) {
    if (!flag) continue;
    const text = String(flag).toUpperCase();
    const tw = doc.getTextWidth(text);
    const pillW = tw + pillPadX * 2;

    // Wrap to next row if needed
    if (curX + pillW > x + maxWidth && curX > x) {
      curX = x;
      curY += pillH + pillGapY;
      curY = checkPageBreak(doc, curY, pillH + pillGapY, priority);
    }

    // Pick color based on flag content (partial match)
    const upperFlag = text;
    let bg = defaultColor;
    for (const [key, color] of Object.entries(flagColors)) {
      if (upperFlag.includes(key)) { bg = color; break; }
    }

    // Draw pill background
    doc.setFillColor(bg[0], bg[1], bg[2]);
    doc.roundedRect(curX, curY, pillW, pillH, cornerR, cornerR, 'F');

    // Draw text (white on colored bg)
    doc.setTextColor(255, 255, 255);
    const pillCapH = fontSize * 0.35;
    const textY = curY + (pillH + pillCapH) / 2;
    doc.text(text, curX + pillPadX, textY);

    curX += pillW + pillGapX;
  }

  // Reset
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFont('helvetica', 'normal');
  return curY + pillH + 1.5;
}

/**
 * Render a "Caution / Officer Safety" block with warning styling.
 * Uses an amber/red tinted background box for high visibility.
 */
export function addCautionBlock(
  doc: jsPDF,
  cautionText: string,
  x: number,
  y: number,
  width: number,
): number {
  if (!cautionText || !cautionText.trim()) return y;

  // @ts-expect-error jsPDF GState — ensure full opacity
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  const innerPad = 2;
  const maxW = width - innerPad * 2;
  doc.setFont('courier', 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  const allLines = wordWrapText(doc, sanitizePdfText(cautionText), maxW - 1);
  const lines = allLines.slice(0, 6);
  if (allLines.length > 6) lines[5] = lines[5].length > 3 ? lines[5].slice(0, -3) + '...' : '...';
  const lineH = 3.5;
  const boxH = Math.max(8, lines.length * lineH + 4);

  // Amber warning background
  doc.setFillColor(255, 248, 230);
  doc.rect(x, y, width, boxH, 'F');
  // Orange left accent bar
  doc.setFillColor(200, 80, 10);
  doc.rect(x, y, 2, boxH, 'F');
  // Border
  doc.setDrawColor(200, 160, 80);
  doc.setLineWidth(0.3);
  doc.rect(x, y, width, boxH);

  // Label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(180, 60, 0);
  doc.text('[!] CAUTION / OFFICER SAFETY', x + innerPad + 2, y + 3);

  // Text content
  doc.setFont('courier', 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  doc.setTextColor(80, 40, 0);
  let textY = y + 6;
  for (const line of lines) {
    doc.text(line, x + innerPad + 2, textY);
    textY += lineH;
  }

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  return y + boxH + 1.5;
}

// ── Active Officer Signature (set per-generation, cleared after) ─

let _activeOfficerSig: PdfSignatureData | undefined;

/** Set the officer's digital signature data for the current PDF generation run */
export function setActiveOfficerSig(sig: PdfSignatureData | undefined) {
  _activeOfficerSig = sig;
}

function getOfficerSig(): PdfSignatureData | undefined {
  return _activeOfficerSig;
}

/** Digital signature data for embedding into PDF signature blocks */
export interface PdfSignatureData {
  /** base64 PNG data URL of the handwritten signature */
  signatureImage?: string | null;
  /** Printed name to fill in */
  printedName?: string;
  /** Badge number to fill in */
  badgeNumber?: string;
  /** Date string (auto-filled if omitted) */
  date?: string;
}

/**
 * Full-page-width signature block with role header, signature line,
 * and sub-fields (Printed Name | Badge # | Date) below.
 * Always renders at full content width (margin to margin).
 * Optionally embeds a digital signature image and pre-fills name/badge/date.
 */
export function addSignatureBlock(
  doc: jsPDF,
  roleLabel: string,
  _x: number,
  y: number,
  blockWidth: number,
  sigData?: PdfSignatureData,
  overrideSigRowH?: number,
  overrideInfoRowH?: number,
): number {
  // @ts-expect-error jsPDF GState — ensure full opacity
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  // Use provided width (allows side-by-side layout)
  const x = _x;
  const width = blockWidth;

  const roleBarH = SPACING.SIGNATURE_ROLE_H;
  const sigRowH = overrideSigRowH ?? 12;
  const infoRowH = overrideInfoRowH ?? 8;
  const totalH = roleBarH + sigRowH + infoRowH;

  // ── Role label header bar ──
  doc.setFillColor(...COLOR.BG_SECTION_HDR);
  doc.rect(x, y, width, roleBarH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_SECTION_TITLE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  const roleCapH = FONT.SIZE_SECTION_TITLE * 0.35;
  const roleTextY = y + (roleBarH + roleCapH) / 2;
  doc.text(sanitizePdfText(roleLabel.toUpperCase()), x + SPACING.CONTENT_INSET, roleTextY);

  // ── Signature area ──
  const row1Y = y + roleBarH;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.rect(x, row1Y, width, sigRowH);

  if (sigData?.signatureImage) {
    try {
      const imgW = Math.min(width * 0.5, 70);
      const imgH = sigRowH - 2;
      doc.addImage(sigData.signatureImage, 'PNG', x + SPACING.MD + 5, row1Y + 1, imgW, imgH);
    } catch { /* skip */ }
  } else {
    // Write-in line + X
    const sigLineY = row1Y + sigRowH - 2.5;
    doc.setDrawColor(...COLOR.TEXT_PRIMARY);
    doc.setLineWidth(BORDER.SIGNATURE_LINE);
    doc.line(x + SPACING.MD, sigLineY, x + width - SPACING.MD, sigLineY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_SIGNATURE_X);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text('X', x + SPACING.CONTENT_INSET, sigLineY - 1.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text('SIGNATURE', x + width / 2, sigLineY + 2, { align: 'center' });
  }

  // ── Info row: PRINTED NAME | BADGE NUMBER | DATE ──
  const row2Y = row1Y + sigRowH;
  const colW = width / 3;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.rect(x, row2Y, width, infoRowH);
  doc.line(x + colW, row2Y, x + colW, row2Y + infoRowH);
  doc.line(x + colW * 2, row2Y, x + colW * 2, row2Y + infoRowH);

  // Labels
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('PRINTED NAME', x + SPACING.MD, row2Y + 2.2);
  doc.text('BADGE NUMBER', x + colW + SPACING.MD, row2Y + 2.2);
  doc.text('DATE/TIME', x + colW * 2 + SPACING.MD, row2Y + 2.2);

  // Values — auto-fill from sigData
  const hasSigData = sigData?.printedName || sigData?.badgeNumber || sigData?.date;
  if (hasSigData) {
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    const valY = row2Y + infoRowH - 1.5;
    if (sigData!.printedName) doc.text(sanitizePdfText(sigData!.printedName).toUpperCase(), x + SPACING.MD, valY);
    if (sigData!.badgeNumber) doc.text(sanitizePdfText(sigData!.badgeNumber).toUpperCase(), x + colW + SPACING.MD, valY);
    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const dateStr = sigData!.date || `${pad2(now.getMonth() + 1)}/${pad2(now.getDate())}/${now.getFullYear()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    doc.text(sanitizePdfText(dateStr), x + colW * 2 + SPACING.MD, valY);
  }

  // Outer border
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.rect(x, y, width, totalH);

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + totalH + SPACING.SM;
}

/**
 * Stacked dual signature layout — two full-width signature blocks,
 * one on top of the other. Each spans the full page width.
 * Use this to replace side-by-side dual signatures.
 */
export function addStackedSignatures(
  doc: jsPDF,
  role1: string,
  _role2: string,
  y: number,
  sig1?: PdfSignatureData,
  _sig2?: PdfSignatureData,
  priority?: string,
): number {
  const mx = LAYOUT.PAGE_MARGIN;
  const cw = getContentWidth(doc);
  const roleBarH = SPACING.SIGNATURE_ROLE_H;
  const sigRowH = 25 - SPACING.SIGNATURE_ROLE_H - 7; // signature fills seal height minus role bar and info row
  const infoRowH = 7;
  const totalH = roleBarH + sigRowH + infoRowH;
  const sealColW = 25; // ~1 inch square (notary stamp size)
  const sigW = cw - sealColW;
  y = checkPageBreak(doc, y, Math.max(totalH, sealColW), priority);

  // ── Reporting Officer signature block (left side) — pass row heights to match seal ──
  addSignatureBlock(doc, role1, mx, y, sigW, sig1, sigRowH, infoRowH);

  // ── Company Seal (right column) — aligned to full signature block height ──
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.rect(mx + sigW, y, sealColW, totalH); // matches signature block height

  // Dashed circle centered in seal column
  const sealH = totalH;
  const circleR = Math.min(sealColW, sealH) / 2 - 2;
  const cx = mx + sigW + sealColW / 2;
  const cy = y + sealH / 2;
  doc.setDrawColor(...COLOR.BORDER_FIELD);
  doc.setLineWidth(0.4);
  const segs = 36;
  for (let i = 0; i < segs; i++) {
    if (i % 2 === 0) {
      const a1 = (i / segs) * 2 * Math.PI;
      const a2 = ((i + 1) / segs) * 2 * Math.PI;
      doc.line(cx + circleR * Math.cos(a1), cy + circleR * Math.sin(a1),
               cx + circleR * Math.cos(a2), cy + circleR * Math.sin(a2));
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('COMPANY', cx, cy - 1.5, { align: 'center' });
  doc.text('SEAL', cx, cy + 2.5, { align: 'center' });

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + Math.max(totalH, sealColW) + SPACING.SM;
}

/**
 * Compact single-line footer: accent bar + form info left, confidential center, page right.
 */
export function addPageFooter(doc: jsPDF, pageNum: number, totalPages: number, formKey?: string) {
  const brand = activeBranding;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const cw = getContentWidth(doc);
  const fKey = formKey || activeFormKey;
  const formNum = FORM_NUMBERS[fKey] || '';

  // @ts-expect-error jsPDF GState — ensure full opacity
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  const accentRgb = hexToRgb(brand.accent_color);
  const primaryRgb = hexToRgb(brand.primary_color);

  // Footer text position — pushed up from edge for print margin safety
  const barY = pageHeight - LAYOUT.FOOTER_HEIGHT - 2;
  const textY = barY + 5;

  // Left: Form # + INTERNAL USE ONLY — bold, readable
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  const leftParts = [formNum, 'INTERNAL USE ONLY'].filter(Boolean);
  doc.text(leftParts.join('  |  '), LAYOUT.PAGE_MARGIN, textY);

  // Right: Page X of Y — bold
  doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - LAYOUT.PAGE_MARGIN, textY, { align: 'right' });
}

/**
 * Wrapped text with paragraph detection and internal page break checking.
 * Double-newlines (\n\n) create paragraph breaks with extra spacing.
 * Single newlines are treated as hard line breaks within a paragraph.
 * Text is justified (words distributed to fill line width) except for
 * the last line of each paragraph which stays left-aligned.
 */
export function addWrappedText(doc: jsPDF, text: string, x: number, y: number, maxWidth: number, fontSize: number = FONT.SIZE_FIELD_VALUE): number {
  if (!text) return y;
  text = sanitizePdfText(text);
  doc.setFont('courier', 'normal');
  doc.setFontSize(fontSize);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  const lineH = fontSize * 0.35 + 0.05;
  const paragraphGap = SPACING.MD;

  const paragraphs = text.split(/\n\n+/);

  for (let p = 0; p < paragraphs.length; p++) {
    if (p > 0) y += paragraphGap;

    const para = paragraphs[p].trim();
    if (!para) continue;

    const lines: string[] = wordWrapText(doc, para, maxWidth - 1);
    for (let li = 0; li < lines.length; li++) {
      y = checkPageBreak(doc, y, lineH + SPACING.SM);
      const line = lines[li];
      const isLastLine = li === lines.length - 1;

      if (!isLastLine && line.trim().length > 0) {
        // Justify: distribute extra space between words
        const words = line.split(/\s+/).filter(w => w.length > 0);
        if (words.length > 1) {
          const textWidth = doc.getTextWidth(words.join(''));
          const extraSpace = (maxWidth - textWidth) / (words.length - 1);
          let cx = x;
          for (let wi = 0; wi < words.length; wi++) {
            doc.text(words[wi], cx, y);
            cx += doc.getTextWidth(words[wi]) + (wi < words.length - 1 ? extraSpace : 0);
          }
        } else {
          doc.text(line, x, y);
        }
      } else {
        doc.text(line, x, y);
      }
      y += lineH;
    }
  }

  return y;
}

/**
 * Render text with simple inline formatting markers:
 * **bold**, *italic*, __underline__
 * Switches between courier normal/bold/bolditalic as needed.
 * Text is justified (words distributed to fill line width) except for
 * the last line of each paragraph which stays left-aligned.
 */
export function addFormattedText(doc: jsPDF, rawText: string, x: number, y: number, maxWidth: number, fontSize: number = FONT.SIZE_FIELD_VALUE, onPageBreak?: (newY: number) => number): number {
  if (!rawText) return y;
  const text = sanitizePdfText(rawText);
  const lineH = fontSize * 0.35 + 0.05; // Consistent line spacing across all text renderers
  const paragraphGap = SPACING.MD;
  // Reduce maxWidth by 2mm safety margin to prevent right-edge clipping when printed
  const safeMaxWidth = maxWidth - 2;
  // Custom word-based line wrapper — jsPDF splitTextToSize breaks mid-word with Courier
  const wordWrap = (str: string, maxW: number): string[] => {
    const words = str.split(/(\s+)/); // Split keeping whitespace tokens
    const result: string[] = [];
    let currentLine = '';
    for (const word of words) {
      if (!word) continue;
      const testLine = currentLine + word;
      const testWidth = doc.getTextWidth(testLine.trimEnd());
      if (testWidth > maxW && currentLine.trim().length > 0) {
        result.push(currentLine.trimEnd());
        currentLine = word.trimStart(); // Start new line without leading space
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine.trim()) result.push(currentLine.trimEnd());
    return result.length > 0 ? result : [str];
  };
  let lastPage = doc.getNumberOfPages();
  const stripMarkers = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/__(.+?)__/g, '$1');
  const hasMarkers = (s: string) => /(\*\*|__|\*[^*])/.test(s);
  const paragraphs = text.split(/\n\n+/);
  for (let p = 0; p < paragraphs.length; p++) {
    if (p > 0) y += paragraphGap;
    const para = paragraphs[p].trim();
    if (!para) continue;

    const hardLines = para.split(/\n/);
    for (let hlIdx = 0; hlIdx < hardLines.length; hlIdx++) {
      const hardLine = hardLines[hlIdx];
      if (!hardLine.trim()) continue;
      // Use bold font width for wrapping if line contains bold markers — bold Courier is wider
      const hasBold = /\*\*/.test(hardLine);
      doc.setFont('courier', hasBold ? 'bold' : 'normal');
      doc.setFontSize(fontSize);
      const stripped = stripMarkers(hardLine);
      const wrappedLines: string[] = wordWrap(stripped, safeMaxWidth);
      doc.setFont('courier', 'normal');
      let charIdx = 0;
      for (let wli = 0; wli < wrappedLines.length; wli++) {
        const wrappedLine = wrappedLines[wli];
        const isLastLine = wli === wrappedLines.length - 1 && hlIdx === hardLines.length - 1;
        y = checkPageBreak(doc, y, lineH + SPACING.SM);
        // If page changed, call onPageBreak to draw section continuation header
        const curPage = doc.getNumberOfPages();
        if (curPage !== lastPage) {
          lastPage = curPage;
          if (onPageBreak) y = onPageBreak(y);
        }
        const lineLen = wrappedLine.length;
        // Skip whitespace between words at line boundaries
        while (charIdx < hardLine.length && hardLine[charIdx] === ' ' && wli > 0) charIdx++;
        let segStart = charIdx;
        let visibleCount = 0;
        let i = charIdx;
        while (visibleCount < lineLen && i < hardLine.length) {
          if (hardLine.slice(i, i + 2) === '**') {
            const end = hardLine.indexOf('**', i + 2);
            if (end !== -1) { visibleCount += end - i - 2; i = end + 2; continue; }
          }
          if (hardLine[i] === '*' && (i + 1 >= hardLine.length || hardLine[i + 1] !== '*')) {
            const end = hardLine.indexOf('*', i + 1);
            if (end !== -1 && (end + 1 >= hardLine.length || hardLine[end + 1] !== '*')) { visibleCount += end - i - 1; i = end + 1; continue; }
          }
          if (hardLine.slice(i, i + 2) === '__') {
            const end = hardLine.indexOf('__', i + 2);
            if (end !== -1) { visibleCount += end - i - 2; i = end + 2; continue; }
          }
          visibleCount++; i++;
        }
        const lineSeg = hardLine.slice(segStart, i);
        charIdx = i;

        // For lines without formatting markers, use justified word spacing
        // Only justify if enough words AND line fills >60% of width AND gap is small
        if (!hasMarkers(lineSeg) && !isLastLine && wrappedLine.trim().length > 0) {
          const words = wrappedLine.split(/\s+/).filter(w => w.length > 0);
          if (words.length > 3) {
            doc.setFont('courier', 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
            const textWidth = doc.getTextWidth(words.join(''));
            const extraSpace = (maxWidth - textWidth) / (words.length - 1);
            const fillRatio = textWidth / maxWidth;
            // Only justify if line fills >60% of width AND extra space per gap <= 1.5mm
            if (extraSpace <= 1.5 && fillRatio > 0.6) {
              let cx = x;
              for (let wi = 0; wi < words.length; wi++) {
                doc.text(words[wi], cx, y);
                cx += doc.getTextWidth(words[wi]) + (wi < words.length - 1 ? extraSpace : 0);
              }
              y += lineH;
              while (charIdx < hardLine.length && hardLine[charIdx] === ' ') charIdx++;
              continue;
            }
          }
        }

        // Lines with formatting markers or last line: render with formatting
        let cursorX = x;
        const segRegex = /(\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__)/g;
        let lastIdx = 0;
        let segMatch: RegExpExecArray | null;
        while ((segMatch = segRegex.exec(lineSeg)) !== null) {
          if (segMatch.index > lastIdx) {
            const plain = lineSeg.slice(lastIdx, segMatch.index);
            doc.setFont('courier', 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
            doc.text(plain, cursorX, y); cursorX += doc.getTextWidth(plain);
          }
          if (segMatch[2]) {
            doc.setFont('courier', 'bold'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
            doc.text(segMatch[2], cursorX, y); cursorX += doc.getTextWidth(segMatch[2]);
          } else if (segMatch[3]) {
            doc.setFont('courier', 'bolditalic'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
            doc.text(segMatch[3], cursorX, y); cursorX += doc.getTextWidth(segMatch[3]);
          } else if (segMatch[4]) {
            doc.setFont('courier', 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
            doc.text(segMatch[4], cursorX, y);
            const tw = doc.getTextWidth(segMatch[4]);
            doc.setDrawColor(...COLOR.TEXT_PRIMARY); doc.setLineWidth(0.2);
            doc.line(cursorX, y + 0.8, cursorX + tw, y + 0.8);
            cursorX += tw;
          }
          lastIdx = segMatch.index + segMatch[0].length;
        }
        if (lastIdx < lineSeg.length) {
          const plain = lineSeg.slice(lastIdx);
          doc.setFont('courier', 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
          doc.text(plain, cursorX, y);
        }
        y += lineH;
      }
      while (charIdx < hardLine.length && hardLine[charIdx] === ' ') charIdx++;
    }
  }
  doc.setFont('courier', 'normal');
  return y;
}

/**
 * Complete narrative/notes section with auto-sizing, background tint,
 * paragraph-aware text, and section border.
 * Replaces the common pattern: openAutoSection → addWrappedText → closeAutoSection.
 */
export function addNarrativeSection(
  doc: jsPDF,
  title: string,
  rawText: string,
  y: number,
  priority?: string,
): number {
  if (!rawText) return y;
  const text = sanitizePdfText(rawText).toUpperCase();
  y = checkPageBreak(doc, y, 30, priority);
  const sec = openAutoSection(doc, title, y);
  y = sec.contentY;

  // Pre-calculate text height for proper background tint sizing
  const lx = getLeftX();
  const ffw = getFullFieldWidth(doc);
  const fontSize = FONT.SIZE_FIELD_VALUE;
  const lineH = fontSize * 0.35 + 0.05; // Match addFormattedText lineStep
  const paragraphGap = SPACING.MD;

  // Estimate total height by splitting text into lines (strip formatting markers for measurement)
  doc.setFont('courier', 'normal');
  doc.setFontSize(fontSize);
  const stripFmt = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/__(.+?)__/g, '$1');
  const paragraphs = text.split(/\n\n+/);
  let totalLines = 0;
  let paraCount = 0;
  for (const para of paragraphs) {
    if (!para.trim()) continue;
    // Split on single newlines first (matches addFormattedText rendering logic)
    const hardLines = para.trim().split(/\n/);
    for (const hl of hardLines) {
      if (!hl.trim()) continue;
      const estCharW = doc.getTextWidth('M');
      const charsPerLine = Math.floor(ffw / estCharW);
      const words = stripFmt(hl.trim()).split(/\s+/);
      let lineCount = 1, lineLen = 0;
      for (const w of words) { if (lineLen + w.length + 1 > charsPerLine && lineLen > 0) { lineCount++; lineLen = w.length; } else { lineLen += (lineLen > 0 ? 1 : 0) + w.length; } }
      const lines = new Array(lineCount);
      totalLines += lines.length;
    }
    paraCount++;
  }
  const estimatedH = totalLines * lineH + Math.max(0, paraCount - 1) * paragraphGap + SPACING.SM + 2;

  // Draw background tint sized to actual content (subtle light gray) — first page only
  const pageH = doc.internal.pageSize.getHeight();
  const maxTintH = Math.min(estimatedH, pageH - y - LAYOUT.FOOTER_HEIGHT - 4);
  doc.setFillColor(246, 246, 250);
  doc.rect(lx - 2, y - 2, ffw + 4, maxTintH, 'F');

  // Page break callback: draw section continuation sub-header + fresh tint
  const contTitle = title.toUpperCase() + ' -- CONTINUED';
  const narrativePageBreak = (newY: number): number => {
    // Draw section sub-header bar
    const cw = getContentWidth(doc);
    doc.setFillColor(...COLOR.BG_SECTION_HDR);
    doc.rect(LAYOUT.PAGE_MARGIN, newY, cw, SPACING.SECTION_HEADER_H, 'F');
    doc.setDrawColor(...COLOR.BORDER_SECTION);
    doc.setLineWidth(BORDER.SECTION_OUTER);
    doc.rect(LAYOUT.PAGE_MARGIN, newY, cw, SPACING.SECTION_HEADER_H);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_SECTION_TITLE);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    const secCapH = FONT.SIZE_SECTION_TITLE * 0.35;
    const textYpos = newY + (SPACING.SECTION_HEADER_H + secCapH) / 2;
    doc.text(contTitle, LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET + 1, textYpos);
    const contentStartY = newY + SPACING.SECTION_HEADER_H + SPACING.SECTION_CONTENT_PAD;
    // Draw fresh background tint for remaining text on this page
    const remainH = pageH - contentStartY - LAYOUT.FOOTER_HEIGHT - 4;
    doc.setFillColor(246, 246, 250);
    doc.rect(lx - 2, contentStartY - 2, ffw + 4, remainH, 'F');
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.setFont('courier', 'normal');
    doc.setFontSize(fontSize);
    return contentStartY;
  };

  // Render text on top (with formatting marker support + page break callback)
  y = addFormattedText(doc, text, lx, y, ffw, fontSize, narrativePageBreak);
  y += SPACING.SM;
  y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  return y;
}

/**
 * Render supplement reports section — reusable across all report templates.
 */
function addSupplementsSection(doc: jsPDF, data: IncidentData, y: number): number {
  const supplements = data.supplements;
  if (!supplements || supplements.length === 0) return y;

  const lx = getLeftX();
  const ffw = getFullFieldWidth(doc);

  for (let si = 0; si < supplements.length; si++) {
    const sup = supplements[si];
    y = checkPageBreak(doc, y, 18, data.priority);
    const supTitle = `Supplement #${si + 1}: ${sup.report_number || ''}${sup.report_type ? ' -- ' + sup.report_type.replace(/_/g, ' ').toUpperCase() : ''}`;

    // Build grid rows for metadata
    const metaRows: FormRow[] = [
      { cells: [
        { label: 'AUTHOR', value: sup.author_name || '', ratio: 2 },
        { label: 'STATUS', value: (sup.status || '').toUpperCase(), ratio: 1 },
        { label: 'DATE', value: sup.created_at || '', ratio: 1 },
      ]},
    ];
    if (sup.subject) {
      metaRows.push({ cells: [
        { label: 'SUBJECT', value: sup.subject, ratio: 1 },
      ], height: 9.5 });
    }

    // Render as boxed section with banner title + grid cells
    y = drawFormSection(doc, {
      sideTab: { label: supTitle },
      topBanner: true,
      rows: metaRows,
      y,
      onPageBreak: formSectionPageBreak,
      afterGrid: (gridEndY: number) => {
        // Render narrative below the grid cells (enough gap to clear cell value text)
        if (sup.narrative) {
          const narY = gridEndY + SPACING.LG;
          const pageH = doc.internal.pageSize.getHeight();
          const fontSize = FONT.SIZE_FIELD_VALUE;
          // Page break callback for supplement narrative continuation
          const contTitle = supTitle.toUpperCase() + ' -- CONTINUED';
          const supPageBreak = (newY: number): number => {
            const cw = getContentWidth(doc);
            doc.setFillColor(...COLOR.BG_SECTION_HDR);
            doc.rect(LAYOUT.PAGE_MARGIN, newY, cw, SPACING.SECTION_HEADER_H, 'F');
            doc.setDrawColor(...COLOR.BORDER_SECTION);
            doc.setLineWidth(BORDER.SECTION_OUTER);
            doc.rect(LAYOUT.PAGE_MARGIN, newY, cw, SPACING.SECTION_HEADER_H);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(FONT.SIZE_SECTION_TITLE);
            doc.setTextColor(...COLOR.TEXT_INVERTED);
            const capH = FONT.SIZE_SECTION_TITLE * 0.35;
            const textYpos = newY + (SPACING.SECTION_HEADER_H + capH) / 2;
            doc.text(sanitizePdfText(contTitle), LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET + 1, textYpos);
            const contentStartY = newY + SPACING.SECTION_HEADER_H + SPACING.SECTION_CONTENT_PAD;
            doc.setTextColor(...COLOR.TEXT_PRIMARY);
            doc.setFont('courier', 'normal');
            doc.setFontSize(fontSize);
            return contentStartY;
          };
          const endY = addFormattedText(doc, sup.narrative, lx, narY, ffw, fontSize, supPageBreak);
          return endY + SPACING.MD;
        }
        return gridEndY;
      },
    });
  }
  return y;
}

// ── Image Rendering Helpers (for attachment embedding) ────────

/** Image data type for PDF embedding (matches pdfImageHelpers.ts ResolvedImage) */
export interface PdfImage {
  dataUrl: string;
  width: number;
  height: number;
  format: 'JPEG' | 'PNG';
  name: string;
}

/** Embed a single image into the PDF with aspect-ratio preservation. */
export function addImageToPage(
  doc: jsPDF,
  image: PdfImage,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
): { w: number; h: number } {
  const aspect = (image.height > 0) ? image.width / image.height : 1;
  let renderW = maxWidth;
  let renderH = aspect > 0 ? renderW / aspect : maxHeight;
  if (renderH > maxHeight) {
    renderH = maxHeight;
    renderW = renderH * aspect;
  }

  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  try {
    doc.addImage(image.dataUrl, image.format, x, y, renderW, renderH);
  } catch {
    doc.setDrawColor(...COLOR.BORDER_FIELD);
    doc.setLineWidth(BORDER.FIELD);
    doc.rect(x, y, renderW, renderH);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text('[Image unavailable]', x + renderW / 2, y + renderH / 2, { align: 'center' });
  }

  return { w: renderW, h: renderH };
}

/** Render a 2-per-row image grid with captions. Returns final Y. */
export function addImageGrid(
  doc: jsPDF,
  images: PdfImage[],
  startY: number,
  priority?: string,
): number {
  const cw = getContentWidth(doc);
  const lx = getLeftX();
  const gap = SPACING.MD;
  const imgMaxW = (cw - 2 * SPACING.CONTENT_INSET - gap) / 2;
  const imgMaxH = 55;
  const captionH = 4;

  let y = startY;

  for (let i = 0; i < images.length; i += 2) {
    const rowImages = images.slice(i, i + 2);
    y = checkPageBreak(doc, y, imgMaxH + captionH + SPACING.SM, priority);

    let maxRowH = 0;
    for (let j = 0; j < rowImages.length; j++) {
      const img = rowImages[j];
      const x = lx + j * (imgMaxW + gap);

      const { w, h } = addImageToPage(doc, img, x, y, imgMaxW, imgMaxH);
      doc.setDrawColor(...COLOR.BORDER_FIELD);
      doc.setLineWidth(BORDER.FIELD);
      doc.rect(x, y, w, h);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      const caption = img.name.length > 40 ? img.name.substring(0, 37) + '...' : img.name;
      doc.text(caption, x, y + h + 3);

      maxRowH = Math.max(maxRowH, h);
    }

    y += maxRowH + captionH + SPACING.LG;
  }

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFont('helvetica', 'normal');
  return y;
}

/** Complete attachments section with auto-sized border. */
export function addAttachmentsSection(
  doc: jsPDF,
  images: PdfImage[],
  y: number,
  title = 'ATTACHMENTS / EVIDENCE PHOTOS',
  priority?: string,
): number {
  if (!images || images.length === 0) return y;

  y = checkPageBreak(doc, y, 40, priority);
  const sec = openAutoSection(doc, title, y);
  y = sec.contentY;
  y = addImageGrid(doc, images, y, priority);
  y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  return y;
}

/**
 * Page break with continuation header on new pages.
 */
export function checkPageBreak(doc: jsPDF, y: number, needed: number, priority?: string): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - LAYOUT.FOOTER_HEIGHT - 5) {
    doc.addPage();
    addConfidentialWatermark(doc);

    const pageWidth = doc.internal.pageSize.getWidth();
    const cw = getContentWidth(doc);

    const contY = 4;
    const contH = SPACING.SECTION_HEADER_H; // Compact continuation header
    // Dark gray continuation bar (full width, no accent edge)
    doc.setFillColor(...COLOR.BG_SECTION_HDR);
    doc.rect(LAYOUT.PAGE_MARGIN, contY, cw, contH, 'F');
    // Bottom border for definition
    doc.setDrawColor(...COLOR.BORDER_SECTION);
    doc.setLineWidth(BORDER.SECTION_OUTER);
    doc.line(LAYOUT.PAGE_MARGIN, contY + contH, LAYOUT.PAGE_MARGIN + cw, contY + contH);

    // Text vertically centered in continuation header
    const contCapH = FONT.SIZE_FIELD_LABEL * 0.35;
    const contTextY = contY + (contH + contCapH) / 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(sanitizePdfText(`${activeBranding.report_header_text} -- CONTINUED`), LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET + 1, contTextY);

    // Form number + case number on right (also vertically centered)
    const rightParts: string[] = [];
    const formNum = FORM_NUMBERS[activeFormKey] || '';
    if (formNum) rightParts.push(formNum);
    if (activeCaseNumber) rightParts.push(activeCaseNumber);
    if (rightParts.length > 0) {
      doc.text(rightParts.join('  |  '), pageWidth - LAYOUT.PAGE_MARGIN - SPACING.CONTENT_INSET, contTextY, { align: 'right' });
    }

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.setDrawColor(...COLOR.TEXT_PRIMARY);

    // Content starts below continuation header — tight, matching section gap
    return contY + contH + SPACING.SECTION_GAP;
  }
  return y;
}

/** Page break handler for drawFormSection — forces a page break with continuation header */
export function formSectionPageBreak(doc: jsPDF, _neededH: number): number {
  // Force a page break by passing a Y beyond the page
  return checkPageBreak(doc, doc.internal.pageSize.getHeight(), 1);
}

/**
 * Professional table with header row background, full borders, zebra striping,
 * auto-wrapping cells with dynamic row heights, and column header re-draw
 * on page breaks.
 */
export function addTableWithShading(
  doc: jsPDF,
  headers: { label: string; x: number }[],
  rows: string[][],
  startY: number,
  colPositions: number[],
  opts?: { lightHeader?: boolean },
): number {
  // @ts-expect-error jsPDF GState — ensure full opacity
  doc.setGState(new doc.GState({ opacity: 1.0 }));
  const cw = getContentWidth(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const minRowH = 6;
  const cellLineH = 3.8;      // Line height within table cells
  const cellPad = 2;           // Padding inside cells
  const maxCellLines = 50;    // Show full note text without truncation

  // Pre-compute column widths from position deltas
  const colWidths: number[] = [];
  for (let c = 0; c < colPositions.length; c++) {
    const nextX = c + 1 < colPositions.length ? colPositions[c + 1] - 2 : pageW - LAYOUT.PAGE_MARGIN - 1;
    colWidths.push(nextX - colPositions[c] - cellPad);
  }

  // Helper to draw header row — dark blocky style (or light field-pair style)
  // atY = top of header rect; text is vertically centered within
  const lightHdr = opts?.lightHeader === true;
  const headerRowH = 5;
  const drawHeaders = (atY: number): number => {
    if (lightHdr) {
      // Light header: white background, thin border, uppercase label (field-pair style)
      doc.setFillColor(255, 255, 255);
      doc.rect(LAYOUT.PAGE_MARGIN + 1, atY, cw - 2, headerRowH, 'F');
      doc.setDrawColor(...COLOR.BORDER_FIELD);
      doc.setLineWidth(BORDER.FIELD);
      doc.rect(LAYOUT.PAGE_MARGIN + 1, atY, cw - 2, headerRowH);
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
    } else {
      // Dark table header (police report style)
      doc.setFillColor(...COLOR.BG_TABLE_HDR);
      doc.rect(LAYOUT.PAGE_MARGIN + 1, atY, cw - 2, headerRowH, 'F');
      doc.setDrawColor(...COLOR.BORDER_OUTER);
      doc.setLineWidth(BORDER.TABLE_OUTER);
      doc.rect(LAYOUT.PAGE_MARGIN + 1, atY, cw - 2, headerRowH);
      doc.setFontSize(FONT.SIZE_TABLE_HEADER);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLOR.TEXT_INVERTED);
    }

    // Text vertically centered: baseline = top + half height + half cap-height
    const fontSize = lightHdr ? FONT.SIZE_FIELD_LABEL : FONT.SIZE_TABLE_HEADER;
    const capH = fontSize * 0.35;  // approximate cap-height in mm
    const textY = atY + (headerRowH + capH) / 2;
    for (const h of headers) {
      doc.text(sanitizePdfText(h.label), h.x, textY);
    }
    return atY + headerRowH;
  };

  let y = drawHeaders(startY);
  const tableTop = startY;

  // Track vertical segment boundaries for column borders (page-aware)
  const colSegments: { top: number; bottom: number; page: number }[] = [{ top: tableTop, bottom: y, page: doc.getNumberOfPages() }];
  let currentSegTop = y;

  // Data rows — Courier for police typewriter look
  doc.setFont('courier', 'normal');
  doc.setFontSize(FONT.SIZE_TABLE_BODY);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Pre-compute wrapped lines for each cell and determine row height
    const cellLines: string[][] = [];
    let maxLines = 1;
    for (let c = 0; c < row.length; c++) {
      const cellText = sanitizePdfText(row[c] || '');
      const availW = colWidths[c] || 30;
      const allCellLines = cellText ? wordWrapText(doc, cellText, availW - 1) : [''];
      const lines = allCellLines.slice(0, maxCellLines);
      if (allCellLines.length > maxCellLines && lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        lines[lines.length - 1] = lastLine.length > 3 ? lastLine.slice(0, -3) + '...' : '...';
      }
      cellLines.push(lines);
      if (lines.length > maxLines) maxLines = lines.length;
    }
    const rowH = Math.max(minRowH, maxLines * cellLineH + 2);

    // Check page break before each row — re-draw headers on new page
    const prevPage = doc.getNumberOfPages();
    const prevY = y;
    y = checkPageBreak(doc, y, rowH + SPACING.SM);
    if (doc.getNumberOfPages() > prevPage) {
      colSegments[colSegments.length - 1].bottom = prevY;
      y = drawHeaders(y);
      currentSegTop = y - 1;
      colSegments.push({ top: currentSegTop, bottom: y, page: doc.getNumberOfPages() });
      doc.setFont('courier', 'normal');
      doc.setFontSize(FONT.SIZE_TABLE_BODY);
    }

    // y = top of this data row rect
    // Zebra shading — rect starts at y, full rowH
    if (i % 2 === 0) {
      doc.setFillColor(...COLOR.BG_ZEBRA);
      doc.rect(LAYOUT.PAGE_MARGIN + 1, y, cw - 2, rowH, 'F');
    }

    // Row separator at bottom of row
    doc.setDrawColor(...COLOR.BORDER_TABLE);
    doc.setLineWidth(BORDER.TABLE_ROW);
    doc.line(LAYOUT.PAGE_MARGIN + 1, y + rowH, LAYOUT.PAGE_MARGIN + cw - 1, y + rowH);

    // Render cell text — vertically centered within row
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    const textBlockH = maxLines * cellLineH;
    const textStartY = y + (rowH - textBlockH) / 2 + cellLineH * 0.7; // center block + baseline offset
    for (let c = 0; c < cellLines.length; c++) {
      const lines = cellLines[c];
      let cellY = textStartY;
      for (const line of lines) {
        doc.text(line, colPositions[c], cellY);
        cellY += cellLineH;
      }
    }

    y += rowH;
  }

  // Update final segment bottom
  colSegments[colSegments.length - 1].bottom = y - 1;

  // Draw column borders and outer border per segment (page-aware)
  const currentPage = doc.getNumberOfPages();
  for (const seg of colSegments) {
    const segH = seg.bottom - seg.top + 1;
    if (segH < 2) continue;

    doc.setPage(seg.page);

    // Vertical column dividers
    doc.setDrawColor(...COLOR.BORDER_COLUMN);
    doc.setLineWidth(BORDER.TABLE_COLUMN);
    for (let c = 1; c < colPositions.length; c++) {
      const sepX = colPositions[c] - 2;
      doc.line(sepX, seg.top, sepX, seg.bottom);
    }

    // Outer border enclosing this segment
    doc.setDrawColor(...COLOR.BORDER_OUTER);
    doc.setLineWidth(BORDER.TABLE_OUTER);
    doc.rect(LAYOUT.PAGE_MARGIN + 1, seg.top, cw - 2, segH);
  }
  // Restore to current (last) page
  doc.setPage(currentPage);

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  return y;
}

/**
 * Three-column grid layout with box-based fields.
 * Partial rows only render fields that exist (no empty placeholder boxes).
 */
export function addThreeColumnFields(
  doc: jsPDF,
  fields: { label: string; value: string }[],
  y: number,
): number {
  const colW = getThirdWidth(doc);
  const lx = getLeftX();

  for (let i = 0; i < fields.length; i += 3) {
    y = checkPageBreak(doc, y, 12); // guard each row of 3 fields
    let maxNextY = y + SPACING.FIELD_ROW_ADVANCE;
    for (let c = 0; c < 3; c++) {
      if (i + c < fields.length) {
        const x = lx + c * colW;
        const nextY = addFieldPair(doc, fields[i + c].label, fields[i + c].value, x, y, colW);
        if (nextY > maxNextY) maxNextY = nextY;
      }
      // No empty placeholder boxes for partial rows
    }
    y = maxNextY;
  }
  return y;
}

// ── Report Data Interfaces ───────────────────────────────────

interface IncidentData {
  incident_number: string;
  incident_type: string;
  priority: string;
  status: string;
  location: string;
  officer_name: string;
  narrative: string;
  occurred_date?: string;
  occurred_time?: string;
  end_date?: string;
  end_time?: string;
  weather_conditions?: string;
  lighting_conditions?: string;
  injuries?: string;
  injury_description?: string;
  damage_estimate?: string;
  damage_description?: string;
  weapons_involved?: string;
  alcohol_involved?: boolean;
  drugs_involved?: boolean;
  domestic_violence?: boolean;
  disposition?: string;
  zone_beat?: string;
  section_id?: string;
  zone_id?: string;
  beat_id?: string;
  responding_le_agency?: string;
  le_case_number?: string;
  badge_number?: string;
  property_name?: string;
  client_name?: string;
  call_number?: string;
  scene_safety?: string;
  direction_of_travel?: string;
  created_at?: string;
  road_conditions?: string;
  traffic_control?: string;
  vehicle_1_info?: string;
  vehicle_2_info?: string;
  diagram_notes?: string;
  patient_status?: string;
  ems_transport?: string;
  patient_vitals?: string;
  treatment_rendered?: string;
  trespass_warning_issued?: boolean;
  trespass_effective_date?: string;
  trespass_expiry_date?: string;
  property_boundaries?: string;
  force_type?: string;
  force_justification?: string;
  subject_injuries?: string;
  officer_injuries?: string;
  de_escalation_attempts?: string;
  linked_persons?: { first_name: string; last_name: string; role: string; dob?: string }[];
  linked_vehicles?: { plate_number?: string; state?: string; year?: string; color?: string; make?: string; model?: string; role: string }[];
  evidence?: { evidence_number: string; evidence_type: string; description: string; storage_location?: string }[];
  // Attachment images (pre-fetched as base64 data URLs)
  attachment_images?: { dataUrl: string; width: number; height: number; format: 'JPEG' | 'PNG'; name: string }[];
  // Extended operational flags
  injuries_reported?: boolean;
  mental_health_crisis?: boolean;
  juvenile_involved?: boolean;
  felony_in_progress?: boolean;
  officer_safety_caution?: boolean;
  k9_requested?: boolean;
  ems_requested?: boolean;
  fire_requested?: boolean;
  hazmat?: boolean;
  gang_related?: boolean;
  evidence_collected?: boolean;
  body_camera_active?: boolean;
  photos_taken?: boolean;
  trespass_issued?: boolean;
  vehicle_pursuit?: boolean;
  foot_pursuit?: boolean;
  le_notified?: boolean;
  supervisor_notified?: boolean;
  // PSO Client Request fields
  contract_id?: string;
  pso_service_type?: string;
  pso_authorization?: string;
  pso_requestor_name?: string;
  pso_requestor_phone?: string;
  pso_requestor_email?: string;
  pso_billing_code?: string;
  // Process Service fields
  process_service_type?: string;
  process_served_to?: string;
  process_served_address?: string;
  process_attempts?: number;
  process_served_at?: string;
  process_service_result?: string;
  // GPS breadcrumb trail (auto-fetched before generation)
  breadcrumb_trail?: {
    points: { lat: number; lng: number; time: string; speed_mph: number | null; road_name?: string | null; nearest_intersection?: string | null; source?: string; call_sign?: string; officer_name?: string }[];
    stats: { total_points: number; total_distance_miles: number; duration_minutes: number; avg_speed_mph: number; max_speed_mph: number; source_breakdown?: Record<string, number> };
  };
  // Source + dispatch code
  source?: string;
  dispatch_code?: string;
  // Geo coordinates
  latitude?: number;
  longitude?: number;
  // Linked call details (auto-filled from dispatch)
  call_created_at?: string;
  call_type?: string;
  caller_name?: string;
  caller_phone?: string;
  call_notes?: string;
  // Supplement reports
  supplements?: {
    report_number: string;
    report_type: string;
    subject: string;
    narrative: string;
    author_name: string;
    status: string;
    created_at: string;
  }[];
}

// ── GPS Activity Log Section (shared across report templates) ──

function addGpsActivityLogSection(doc: jsPDF, data: IncidentData, y: number, priority: string): number {
  const lx = getLeftX();
  const trail = data.breadcrumb_trail;

  y = checkPageBreak(doc, y, 30, priority);
  const sec = openAutoSection(doc, 'GPS Activity Log', y); y = sec.contentY;

  if (trail && trail.points.length > 0) {
    const stats = trail.stats;
    y = addThreeColumnFields(doc, [
      { label: 'Total Distance', value: `${stats.total_distance_miles} mi` },
      { label: 'Duration', value: `${stats.duration_minutes} min` },
      { label: 'Avg Speed', value: `${stats.avg_speed_mph} mph` },
      { label: 'Max Speed', value: `${stats.max_speed_mph} mph` },
      { label: 'Breadcrumb Points', value: String(stats.total_points) },
      { label: 'Sources', value: stats.source_breakdown
        ? Object.entries(stats.source_breakdown).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(', ')
        : '' },
    ], y);
    y += SPACING.SM;

    // Sampled breadcrumb table — max 50 rows for readability
    const maxRows = 50;
    const step = trail.points.length > maxRows ? Math.ceil(trail.points.length / maxRows) : 1;
    const sampled = trail.points.filter((_, i) => i % step === 0 || i === trail.points.length - 1);

    const colPositions = [lx, LAYOUT.PAGE_MARGIN + 38, LAYOUT.PAGE_MARGIN + 100, LAYOUT.PAGE_MARGIN + 130];
    const tableHeaders = [
      { label: 'TIME', x: colPositions[0] },
      { label: 'LOCATION / ROAD', x: colPositions[1] },
      { label: 'SPEED', x: colPositions[2] },
      { label: 'SOURCE', x: colPositions[3] },
    ];
    const tableRows = sampled.map(p => {
      let timeStr = '';
      try {
        timeStr = new Date(p.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      } catch { timeStr = p.time; }
      // Prefer road name + nearest intersection, fall back to raw coordinates
      let locationStr = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
      if (p.road_name) {
        locationStr = p.road_name;
        if (p.nearest_intersection) locationStr += ` / ${p.nearest_intersection}`;
      }
      return [
        timeStr,
        locationStr,
        p.speed_mph != null ? `${p.speed_mph} mph` : '-',
        (p.source || 'unknown').toUpperCase(),
      ];
    });

    y = addTableWithShading(doc, tableHeaders, tableRows, y, colPositions);

    if (step > 1) {
      doc.setFontSize(5);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text(`Showing ${sampled.length} of ${trail.points.length} breadcrumb points (sampled every ${step} points)`, lx, y + 1);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      y += SPACING.MD;
    }
  } else {
    doc.setFontSize(FONT.SIZE_TABLE_BODY);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text('No GPS breadcrumb data available', lx, y);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    y += SPACING.XL;
  }

  y = closeAutoSection(doc, sec.sectionY, y);
  return y;
}

// ── Report Templates ─────────────────────────────────────────

function generateGeneralIncident(doc: jsPDF, data: IncidentData) {
  const pageW = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const mx = LAYOUT.PAGE_MARGIN;  // margin x
  const capFirst = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';


  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'UNIFORM INCIDENT REPORT',
    formNumber: FORM_NUMBERS.incident,
    caseNumber: data.incident_number,
    reportDate: data.occurred_date || data.created_at || '',
  });

  // ═══════════════════════════════════════════════════════════
  // SECTION 1 — ADMINISTRATIVE DATA
  // ═════���═════════════════════════════════════════════════════
  y = drawFormSection(doc, {
    sideTab: { label: 'ADMINISTRATIVE' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: 'INCIDENT TYPE', value: formatIncidentType(data.incident_type), ratio: 3, valueBold: true },
        { label: 'TYPE CODE', value: getTypeCode(data.incident_type), ratio: 1, align: 'center' },
        { label: 'INCIDENT #', value: data.incident_number || '', ratio: 2, valueBold: true },
        { label: 'STATUS', value: data.status?.toUpperCase() || '', ratio: 1, align: 'center' },
      ]},
      { cells: [
        { label: 'OCCURRED DATE', value: data.occurred_date || '', ratio: 1 },
        { label: 'TIME', value: data.occurred_time || '', ratio: 1, align: 'center' },
        { label: 'END DATE', value: data.end_date || '', ratio: 1 },
        { label: 'TIME', value: data.end_time || '', ratio: 1, align: 'center' },
        { label: 'PRIORITY', value: data.priority || '', ratio: 1, align: 'center', valueBold: true },
        { label: 'DISPOSITION', value: data.disposition || '', ratio: 1 },
      ]},
      { cells: [
        { label: 'REPORTING OFFICER', value: data.officer_name || '', ratio: 3, valueBold: true },
        { label: 'BADGE #', value: data.badge_number || '', ratio: 1, align: 'center' },
      ]},
      { cells: [
        { label: 'ADDRESS', value: data.location || '', ratio: 1, valueBold: true },
      ]},
      { cells: [
        { label: 'DISPATCH CODE', value: data.dispatch_code || '', ratio: 1, align: 'center', valueBold: true },
        { label: 'SECTION', value: data.section_id || '', ratio: 1, align: 'center' },
        { label: 'ZONE', value: data.zone_id || '', ratio: 1, align: 'center' },
        { label: 'BEAT', value: data.beat_id || '', ratio: 1, align: 'center' },
        { label: 'RESPONDING AGENCY', value: data.responding_le_agency || '', ratio: 2 },
        { label: 'LE CASE #', value: data.le_case_number || '', ratio: 1 },
      ]},
    ],
    y,
  });

  // ═══════════════════════════════════════════════════════════
  // SECTION 2 — CLASSIFICATION & CONTRACT
  // ═══════════════════════════════════════════════════════════
  { const classRows: FormRow[] = [];
    const row1: FormCell[] = [];
    if (data.property_name) row1.push({ label: 'PROPERTY / LOCATION NAME', value: data.property_name, ratio: 2 });
    if (data.client_name) row1.push({ label: 'CLIENT', value: data.client_name, ratio: 1 });
    if (data.contract_id) row1.push({ label: 'CONTRACT ID', value: data.contract_id, ratio: 1, align: 'center' });
    if (data.call_number) row1.push({ label: 'CFS CALL #', value: data.call_number, ratio: 1 });
    if (row1.length > 0) {
      classRows.push({ cells: row1 });
      y = drawFormSection(doc, {
        sideTab: { label: 'CLASSIFICATION' },
        topBanner: true,
        onPageBreak: formSectionPageBreak,
        rows: classRows,
        y,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 3 — SCENE / CONDITIONS
  // ═══════════════════════════════════════════════════════════
  { const hasScene = data.scene_safety || data.weather_conditions || data.lighting_conditions || data.weapons_involved || data.direction_of_travel;
    if (hasScene) {
      y = drawFormSection(doc, {
        sideTab: { label: 'SCENE / CONDITIONS' },
        topBanner: true,
        onPageBreak: formSectionPageBreak,
        rows: [
          { cells: [
            { label: 'SCENE SAFETY', value: data.scene_safety || 'N/A', ratio: 1 },
            { label: 'WEATHER', value: data.weather_conditions || 'N/A', ratio: 1 },
            { label: 'LIGHTING', value: data.lighting_conditions || 'N/A', ratio: 1 },
          ]},
          { cells: [
            { label: 'WEAPONS INVOLVED', value: data.weapons_involved || 'None', ratio: 1 },
            { label: 'DIRECTION OF TRAVEL', value: data.direction_of_travel || 'N/A', ratio: 1 },
          ]},
        ],
        y,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 4 — INJURIES / DAMAGE
  // ═══════════════════════════════════════════════════════════
  if (data.injuries || data.injury_description || data.damage_estimate || data.damage_description) {
    y = drawFormSection(doc, {
      sideTab: { label: 'INJURIES / DAMAGE' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: 'INJURIES', value: capFirst(data.injuries || 'None'), ratio: 1 },
          { label: 'INJURY DESCRIPTION', value: data.injury_description || '', ratio: 2 },
        ]},
        { cells: [
          { label: 'DAMAGE ESTIMATE', value: data.damage_estimate ? '$' + data.damage_estimate : 'N/A', ratio: 1 },
          { label: 'DAMAGE DESCRIPTION', value: data.damage_description || '', ratio: 2 },
        ]},
      ],
      y,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 5 — OPERATIONAL FLAGS (checkbox grid)
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(doc, y, 42, data.priority);
  y = drawFormSection(doc, {
    sideTab: { label: 'OPERATIONAL FLAGS' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: 'INJURIES', value: '', checkbox: true, checked: !!data.injuries_reported, ratio: 1 },
        { label: 'ALCOHOL', value: '', checkbox: true, checked: !!data.alcohol_involved, ratio: 1 },
        { label: 'DRUGS', value: '', checkbox: true, checked: !!data.drugs_involved, ratio: 1 },
        { label: 'DV', value: '', checkbox: true, checked: !!data.domestic_violence, ratio: 1 },
        { label: 'MENTAL HEALTH', value: '', checkbox: true, checked: !!data.mental_health_crisis, ratio: 1 },
        { label: 'JUVENILE', value: '', checkbox: true, checked: !!data.juvenile_involved, ratio: 1 },
      ]},
      { cells: [
        { label: 'FELONY I/P', value: '', checkbox: true, checked: !!data.felony_in_progress, ratio: 1 },
        { label: 'OFC SAFETY', value: '', checkbox: true, checked: !!data.officer_safety_caution, ratio: 1 },
        { label: 'GANG', value: '', checkbox: true, checked: !!data.gang_related, ratio: 1 },
        { label: 'HAZMAT', value: '', checkbox: true, checked: !!data.hazmat, ratio: 1 },
        { label: 'WEAPONS', value: '', checkbox: true, checked: !!data.weapons_involved, ratio: 1 },
        { label: 'VEH PURSUIT', value: '', checkbox: true, checked: !!data.vehicle_pursuit, ratio: 1 },
      ]},
      { cells: [
        { label: 'K9 REQ', value: '', checkbox: true, checked: !!data.k9_requested, ratio: 1 },
        { label: 'EMS REQ', value: '', checkbox: true, checked: !!data.ems_requested, ratio: 1 },
        { label: 'FIRE REQ', value: '', checkbox: true, checked: !!data.fire_requested, ratio: 1 },
        { label: 'BWC ACTIVE', value: '', checkbox: true, checked: !!data.body_camera_active, ratio: 1 },
        { label: 'EVIDENCE', value: '', checkbox: true, checked: !!data.evidence_collected, ratio: 1 },
        { label: 'PHOTOS', value: '', checkbox: true, checked: !!data.photos_taken, ratio: 1 },
      ]},
      { cells: [
        { label: 'SUPVR NOTIFIED', value: '', checkbox: true, checked: !!data.supervisor_notified, ratio: 1 },
        { label: 'LE NOTIFIED', value: '', checkbox: true, checked: !!data.le_notified, ratio: 1 },
        { label: 'TRESPASS', value: '', checkbox: true, checked: !!data.trespass_issued, ratio: 1 },
        { label: 'FOOT PURSUIT', value: '', checkbox: true, checked: !!data.foot_pursuit, ratio: 1 },
        { label: '', value: '', ratio: 1 },
        { label: '', value: '', ratio: 1 },
      ]},
    ],
    y,
  });

  // ═══════════════════════════════════════════════════════════
  // SECTION 6 — PERSONS INVOLVED
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(doc, y, 20, data.priority);
  const persons = data.linked_persons || [];
  { const sec = openAutoSection(doc, `Persons Involved (${persons.length})`, y); y = sec.contentY;
    if (persons.length > 0) {
      const colPositions = [lx, mx + 30, mx + 70, mx + 110];
      const tableHeaders = [
        { label: 'ROLE', x: colPositions[0] },
        { label: 'LAST NAME', x: colPositions[1] },
        { label: 'FIRST NAME', x: colPositions[2] },
        { label: 'DOB', x: colPositions[3] },
      ];
      const tableRows = persons.map((p) => [
        capFirst(p.role?.replace(/_/g, ' ') || ''),
        (p.last_name || '').toUpperCase(),
        p.first_name || '',
        p.dob || '',
      ]);
      y = addTableWithShading(doc, tableHeaders, tableRows, y, colPositions);
    } else {
      doc.setFontSize(FONT.SIZE_TABLE_BODY); doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('None recorded', lx, y); doc.setTextColor(...COLOR.TEXT_PRIMARY); y += SPACING.XL;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 7 — VEHICLES INVOLVED
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(doc, y, 20, data.priority);
  const vehicles = data.linked_vehicles || [];
  { const sec = openAutoSection(doc, `Vehicles Involved (${vehicles.length})`, y); y = sec.contentY;
    if (vehicles.length > 0) {
      const colPositions = [lx, mx + 30, mx + 65, mx + 120];
      const tableHeaders = [
        { label: 'ROLE', x: colPositions[0] },
        { label: 'PLATE', x: colPositions[1] },
        { label: 'YEAR/MAKE/MODEL', x: colPositions[2] },
        { label: 'COLOR', x: colPositions[3] },
      ];
      const tableRows = vehicles.map((v) => [
        capFirst(v.role?.replace(/_/g, ' ') || ''),
        `${v.plate_number || 'N/A'}${v.state ? ' (' + v.state + ')' : ''}`,
        [v.year, v.make, v.model].filter(Boolean).join(' '),
        v.color || '',
      ]);
      y = addTableWithShading(doc, tableHeaders, tableRows, y, colPositions);
    } else {
      doc.setFontSize(FONT.SIZE_TABLE_BODY); doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('None recorded', lx, y); doc.setTextColor(...COLOR.TEXT_PRIMARY); y += SPACING.XL;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 8 — EVIDENCE / PROPERTY
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(doc, y, 20, data.priority);
  const evidence = data.evidence || [];
  { const sec = openAutoSection(doc, `Evidence / Property (${evidence.length})`, y); y = sec.contentY;
    if (evidence.length > 0) {
      const colPositions = [lx, mx + 36, mx + 60, mx + 130];
      const tableHeaders = [
        { label: 'ITEM #', x: colPositions[0] },
        { label: 'TYPE', x: colPositions[1] },
        { label: 'DESCRIPTION', x: colPositions[2] },
        { label: 'STORAGE LOCATION', x: colPositions[3] },
      ];
      const tableRows = evidence.map((e) => [
        e.evidence_number || '',
        capFirst(e.evidence_type || ''),
        e.description || '',
        e.storage_location || '',
      ]);
      y = addTableWithShading(doc, tableHeaders, tableRows, y, colPositions);
    } else {
      doc.setFontSize(FONT.SIZE_TABLE_BODY); doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('None recorded', lx, y); doc.setTextColor(...COLOR.TEXT_PRIMARY); y += SPACING.XL;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 9 — EXTERNAL AGENCY COORDINATION
  // ═══════════════════════════════════════════════════════════
  if (data.responding_le_agency || data.le_case_number) {
    y = checkPageBreak(doc, y, 14, data.priority);
    y = drawFormSection(doc, {
      sideTab: { label: 'EXTERNAL AGENCY' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [{ cells: [
        { label: 'RESPONDING AGENCY', value: data.responding_le_agency || '', ratio: 2 },
        { label: 'LE CASE #', value: data.le_case_number || '', ratio: 1 },
      ]}],
      y,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 10 — DISPATCH / CALL DETAILS
  // ═══════════════════════════════════════════════════════════
  if (data.call_number || data.call_type || data.caller_name || data.call_notes) {
    y = checkPageBreak(doc, y, 22, data.priority);
    const dispatchRows: FormRow[] = [];
    const r1: FormCell[] = [];
    if (data.call_number) r1.push({ label: 'CFS CALL #', value: data.call_number, ratio: 1, valueBold: true });
    if (data.call_type) r1.push({ label: 'CALL TYPE', value: data.call_type.replace(/_/g, ' ').toUpperCase(), ratio: 1 });
    if (data.call_created_at) r1.push({ label: 'DISPATCHED', value: data.call_created_at, ratio: 1 });
    if (r1.length > 0) dispatchRows.push({ cells: r1 });
    const r2: FormCell[] = [];
    if (data.caller_name) r2.push({ label: 'CALLER NAME', value: data.caller_name, ratio: 2 });
    if (data.caller_phone) r2.push({ label: 'CALLER PHONE', value: data.caller_phone, ratio: 1 });
    const geoStr = (data.latitude != null && data.longitude != null) ? `${Number(data.latitude).toFixed(5)}, ${Number(data.longitude).toFixed(5)}` : '';
    if (geoStr) r2.push({ label: 'GEO COORDINATES', value: geoStr, ratio: 1 });
    if (r2.length > 0) dispatchRows.push({ cells: r2 });
    if (dispatchRows.length > 0) {
      y = drawFormSection(doc, {
        sideTab: { label: 'DISPATCH DATA' },
        topBanner: true,
        onPageBreak: formSectionPageBreak,
        rows: dispatchRows,
        y,
        afterGrid: (gridY: number) => {
          if (data.call_notes) {
            const ny = gridY + SPACING.LG;
            const endY = addFormattedText(doc, data.call_notes, lx, ny, ffw);
            return endY + SPACING.MD;
          }
          return gridY;
        },
      });
    }
  }

  // ── GPS Coordinates (standalone if no call data) ───────────
  if (!data.call_number && data.latitude != null && data.longitude != null) {
    y = drawFormSection(doc, {
      sideTab: { label: 'GEO LOCATION' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [{ cells: [
        { label: 'LATITUDE', value: String(data.latitude), ratio: 1 },
        { label: 'LONGITUDE', value: String(data.longitude), ratio: 1 },
      ]}],
      y,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 11 — OFFICER NARRATIVE
  // ═══════════════════════════════════════════════════════════
  y = addNarrativeSection(doc, 'Officer Narrative', data.narrative || '', y, data.priority);

  // ═══════════════════════════════════════════════════════════
  // SECTION 12 — SUPPLEMENT REPORTS
  // ═══════════════════════════════════════════════════════════
  y = addSupplementsSection(doc, data, y);

  // ═══════════════════════════════════════════════════════════
  // SECTION 13 — ATTACHMENTS / EVIDENCE PHOTOS
  // ═══════════════════════════════════════════════════════════
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 14 — SIGNATURES / APPROVAL
  // ═══════════════════════════════════════════════════════════
  y = addStackedSignatures(doc, 'Reporting Officer', 'Supervisor Review', y, getOfficerSig(), undefined, data.priority);
}

function generateTrespassWarning(doc: jsPDF, data: IncidentData) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const gridX = getGridStartX();
  const gridW = getGridContentWidth(doc);

  const persons = data.linked_persons || [];
  const subj = persons[0] || { first_name: '', last_name: '', dob: '' };

  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'NOTICE OF TRESPASS WARNING',
    formNumber: FORM_NUMBERS.trespass,
    caseNumber: data.incident_number,
    reportDate: data.occurred_date || data.created_at || '',
  });

  // Large WARNING banner
  const primaryRgb = hexToRgb(activeBranding.primary_color);
  doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.rect(LAYOUT.PAGE_MARGIN, y, cw, 10, 'F');
  doc.setDrawColor(...COLOR.TEXT_INVERTED);
  doc.setLineWidth(BORDER.CASE_BOX);
  doc.rect(LAYOUT.PAGE_MARGIN + 1.5, y + 1.2, cw - 3, 7.6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_BANNER);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text('WARNING -- TRESPASS NOTICE', pageWidth / 2, y + 7, { align: 'center' });
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  y += 12;

  // Subject Details
  { const sec = openAutoSection(doc, 'Subject Information', y); y = sec.contentY;
    const persons = data.linked_persons || [];
    if (persons.length > 0) {
      const subj = persons[0];
      y = addThreeColumnFields(doc, [
        { label: 'Last Name', value: subj.last_name || '' },
        { label: 'First Name', value: subj.first_name || '' },
        { label: 'DOB', value: subj.dob || '' },
      ], y);
    } else {
      y = addFieldPair(doc, 'Name', '', lx, y, ffw);
      y = addFieldPair(doc, 'DOB', '', lx, y, hfw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Property Information
  { const sec = openAutoSection(doc, 'Property Information', y); y = sec.contentY;
    y = addFieldPair(doc, 'Location', data.location, lx, y, ffw);
    y = addFieldPair(doc, 'Property Boundaries', data.property_boundaries || '', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Warning Dates
  { const sec = openAutoSection(doc, 'Warning Period', y); y = sec.contentY;
    { const yL = addFieldPair(doc, 'Effective Date', data.trespass_effective_date || '', lx, y, hfw);
      const yR = addFieldPair(doc, 'Expiry Date', data.trespass_expiry_date || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Warning Text
  { const sec = openAutoSection(doc, 'Notice', y); y = sec.contentY;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_FIELD_VALUE);
    const warningText = 'You are hereby notified that you are PROHIBITED from entering, remaining upon, or returning to the above-described property. Any violation of this warning may result in your arrest for Criminal Trespass pursuant to applicable state law. This warning is effective for the period indicated above.';
    y = addWrappedText(doc, warningText, lx, y, ffw, 9);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // GPS Activity Log
  y = addGpsActivityLogSection(doc, data, y, data.priority);

  // Narrative
  y = addNarrativeSection(doc, 'Officer Notes', data.narrative || '', y, data.priority);
  y = addSupplementsSection(doc, data, y);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  // Signatures
  y = checkPageBreak(doc, y, 80, data.priority);
  y = addSignatureBlock(doc, 'Subject (Acknowledgment of Receipt)', lx, y, ffw);
  y = addStackedSignatures(doc, 'Issuing Officer', '', y, getOfficerSig());

  // Distribution
  y += SPACING.LG;
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('DISTRIBUTION: ORIGINAL -- FILE | COPY 1 -- SUBJECT | COPY 2 -- PROPERTY MANAGEMENT', lx, y);
}

function generateAccidentReport(doc: jsPDF, data: IncidentData) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const gridX = getGridStartX();
  const gridW = getGridContentWidth(doc);

  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'VEHICLE ACCIDENT REPORT',
    formNumber: FORM_NUMBERS.accident,
    caseNumber: data.incident_number,
    reportDate: data.occurred_date || data.created_at || '',
  });

  // ═══════════════════════════════════════════════════════════
  // ADMINISTRATIVE — incident + conditions grid
  // ═══════════════════════════════════════════════════════════
  y = drawFormSection(doc, {
    sideTab: { label: 'ADMINISTRATIVE' },
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '1. INCIDENT #', value: data.incident_number || '', ratio: 2, valueBold: true },
        { label: '2. DATE', value: data.occurred_date || '', ratio: 1 },
        { label: '3. TIME', value: data.occurred_time || '', ratio: 1 },
        { label: '4. INVESTIGATING OFFICER', value: data.officer_name || '', ratio: 2 },
      ]},
      { cells: [
        { label: '5. LOCATION OF ACCIDENT', value: data.location || '', ratio: 1, valueBold: true },
      ]},
      { cells: [
        { label: '6. ROAD CONDITIONS', value: data.road_conditions || '', ratio: 1 },
        { label: '7. TRAFFIC CONTROL', value: data.traffic_control || '', ratio: 1 },
        { label: '8. WEATHER', value: data.weather_conditions || '', ratio: 1 },
        { label: '9. LIGHTING', value: data.lighting_conditions || '', ratio: 1 },
      ]},
    ],
    y,
  });

  // Incident Info
  { const sec = openAutoSection(doc, 'Incident Information', y); y = sec.contentY;
    y = addFieldPair(doc, 'Location', data.location, lx, y, ffw);
    y = addThreeColumnFields(doc, [
      { label: 'Date', value: data.occurred_date || '' },
      { label: 'Time', value: data.occurred_time || '' },
      { label: 'Officer', value: data.officer_name },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Road Conditions
  { const sec = openAutoSection(doc, 'Conditions', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Road Conditions', value: data.road_conditions || '' },
      { label: 'Traffic Control', value: data.traffic_control || '' },
      { label: 'Weather', value: data.weather_conditions || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Flags
  { const sec = openAutoSection(doc, 'Flags', y); y = sec.contentY;
    let flagX = lx;
    flagX = addCheckboxField(doc, 'Alcohol', !!data.alcohol_involved, flagX, y);
    flagX = addCheckboxField(doc, 'Drugs', !!data.drugs_involved, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Gang', !!data.gang_related, flagX + SPACING.SM, y);
    if (data.weapons_involved) {
      addCheckboxField(doc, 'Weapons: ' + data.weapons_involved, true, flagX + SPACING.SM, y);
    } else {
      addCheckboxField(doc, 'Weapons', false, flagX + SPACING.SM, y);
    }
    y += SPACING.LG; flagX = lx;
    flagX = addCheckboxField(doc, 'BWC Active', !!data.body_camera_active, flagX, y);
    flagX = addCheckboxField(doc, 'Photos', !!data.photos_taken, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Evidence', !!data.evidence_collected, flagX + SPACING.SM, y);
    addCheckboxField(doc, 'LE Notified', !!data.le_notified, flagX + SPACING.SM, y);
    y += SPACING.XL;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Vehicle 1
  { const sec = openAutoSection(doc, 'Vehicle #1', y); y = sec.contentY;
    y = addFieldPair(doc, 'Vehicle Description', data.vehicle_1_info || '', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Vehicle 2
  y = checkPageBreak(doc, y, 30, data.priority);
  { const sec = openAutoSection(doc, 'Vehicle #2', y); y = sec.contentY;
    y = addFieldPair(doc, 'Vehicle Description', data.vehicle_2_info || '', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Diagram area
  y = checkPageBreak(doc, y, 80, data.priority);
  { const sec = openAutoSection(doc, 'Accident Diagram', y); y = sec.contentY;
    doc.setDrawColor(...COLOR.BORDER_TABLE);
    doc.setLineWidth(BORDER.DIAGRAM_GRID);
    for (let gx = LAYOUT.PAGE_MARGIN + LAYOUT.DIAGRAM_GRID_STEP; gx < pageWidth - LAYOUT.PAGE_MARGIN; gx += LAYOUT.DIAGRAM_GRID_STEP) {
      doc.line(gx, y, gx, y + 55);
    }
    for (let gy = y; gy < y + 55; gy += LAYOUT.DIAGRAM_GRID_STEP) {
      doc.line(lx, gy, pageWidth - LAYOUT.PAGE_MARGIN - SPACING.MD, gy);
    }
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text('(DRAW DIAGRAM -- INDICATE NORTH, VEHICLES, DIRECTION OF TRAVEL, POINT OF IMPACT)', pageWidth / 2, y + 60, { align: 'center' });
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.setDrawColor(...COLOR.TEXT_PRIMARY);
    y += 65;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Scene Notes
  y = addNarrativeSection(doc, 'Scene Notes', data.diagram_notes || '', y, data.priority);

  // Injuries & Damage
  y = checkPageBreak(doc, y, 20, data.priority);
  { const sec = openAutoSection(doc, 'Injuries & Damage', y); y = sec.contentY;
    { const yL = addFieldPair(doc, 'Injuries', `${data.injuries || 'None'}${data.injury_description ? ' -- ' + data.injury_description : ''}`, lx, y, hfw);
      const yR = addFieldPair(doc, 'Damage Estimate', data.damage_estimate ? '$' + data.damage_estimate : '', rx, y, hfw);
      y = Math.max(yL, yR); }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // GPS, Narrative, Attachments, Signatures
  y = addGpsActivityLogSection(doc, data, y, data.priority);
  y = addNarrativeSection(doc, 'Narrative', data.narrative || '', y, data.priority);
  y = addSupplementsSection(doc, data, y);

  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  y = checkPageBreak(doc, y, 40, data.priority);
  y = addStackedSignatures(doc, 'Investigating Officer', '', y, getOfficerSig());
}

function generateMedicalReport(doc: jsPDF, data: IncidentData) {
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const gridX = getGridStartX();
  const gridW = getGridContentWidth(doc);

  const persons = data.linked_persons || [];
  const patient = persons[0] || { first_name: '', last_name: '', dob: '' };

  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'MEDICAL RESPONSE REPORT',
    formNumber: FORM_NUMBERS.medical,
    caseNumber: data.incident_number,
    reportDate: data.occurred_date || data.created_at || '',
  });

  // Incident Info
  { const sec = openAutoSection(doc, 'Incident Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Type', value: formatIncidentType(data.incident_type) },
      { label: 'Priority', value: data.priority },
      { label: 'Officer', value: data.officer_name },
    ], y);
    y = addFieldPair(doc, 'Location', data.location, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Patient Information
  { const sec = openAutoSection(doc, 'Patient Information', y); y = sec.contentY;
    const persons = data.linked_persons || [];
    if (persons.length > 0) {
      const patient = persons[0];
      y = addThreeColumnFields(doc, [
        { label: 'Name', value: `${patient.last_name}, ${patient.first_name}` },
        { label: 'DOB', value: patient.dob || '' },
        { label: 'Patient Status', value: data.patient_status || '' },
      ], y);
    } else {
      y = addThreeColumnFields(doc, [
        { label: 'Name', value: '' },
        { label: 'DOB', value: '' },
        { label: 'Patient Status', value: data.patient_status || '' },
      ], y);
    }
    y = addFieldPair(doc, 'EMS Transport', data.ems_transport || '', lx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Free-form sections
  y = addNarrativeSection(doc, 'Vitals / Condition', data.patient_vitals || '', y, data.priority);
  y = addNarrativeSection(doc, 'Treatment Rendered', data.treatment_rendered || '', y, data.priority);
  y = addGpsActivityLogSection(doc, data, y, data.priority);
  y = addNarrativeSection(doc, 'Narrative', data.narrative || '', y, data.priority);
  y = addSupplementsSection(doc, data, y);

  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  y = checkPageBreak(doc, y, 75, data.priority);
  y = addSignatureBlock(doc, 'Patient Refusal (if applicable)', lx, y, ffw);
  y = addStackedSignatures(doc, 'Responding Officer', '', y, getOfficerSig());
}

function generateUseOfForceReport(doc: jsPDF, data: IncidentData) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const gridX = getGridStartX();
  const gridW = getGridContentWidth(doc);

  const persons = data.linked_persons || [];
  const subj = persons[0] || { first_name: '', last_name: '', dob: '' };

  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'USE OF FORCE REPORT',
    formNumber: FORM_NUMBERS.use_of_force,
    caseNumber: data.incident_number,
    reportDate: data.occurred_date || data.created_at || '',
  });

  // MANDATORY header banner
  const primaryRgb = hexToRgb(activeBranding.primary_color);
  doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.rect(LAYOUT.PAGE_MARGIN, y, cw, 8, 'F');
  doc.setDrawColor(...COLOR.TEXT_INVERTED);
  doc.setLineWidth(BORDER.BANNER);
  doc.rect(LAYOUT.PAGE_MARGIN + 1, y + 1, cw - 2, 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_BANNER_SMALL);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text('MANDATORY REPORT -- MUST BE COMPLETED WITHIN 24 HOURS OF INCIDENT', pageWidth / 2, y + 5.5, { align: 'center' });
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  y += 12;

  // Incident Info
  { const sec = openAutoSection(doc, 'Incident Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Type', value: formatIncidentType(data.incident_type) },
      { label: 'Date/Time', value: `${data.occurred_date || ''} ${data.occurred_time || ''}` },
      { label: 'Officer', value: data.officer_name },
    ], y);
    y = addFieldPair(doc, 'Location', data.location, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Subject Information
  { const sec = openAutoSection(doc, 'Subject Information', y); y = sec.contentY;
    const persons = data.linked_persons || [];
    if (persons.length > 0) {
      const subj = persons[0];
      y = addThreeColumnFields(doc, [
        { label: 'Name', value: `${subj.last_name}, ${subj.first_name}` },
        { label: 'DOB', value: subj.dob || '' },
        { label: 'Force Type / Level', value: data.force_type || '' },
      ], y);
    } else {
      y = addThreeColumnFields(doc, [
        { label: 'Name', value: '' },
        { label: 'DOB', value: '' },
        { label: 'Force Type / Level', value: data.force_type || '' },
      ], y);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Free-form sections
  y = addNarrativeSection(doc, 'De-Escalation Attempts', data.de_escalation_attempts || '', y, data.priority);
  y = addNarrativeSection(doc, 'Justification', data.force_justification || '', y, data.priority);

  // Injuries
  y = checkPageBreak(doc, y, 20, data.priority);
  { const sec = openAutoSection(doc, 'Injuries', y); y = sec.contentY;
    { const yL = addFieldPair(doc, 'Subject Injuries', data.subject_injuries || 'None', lx, y, hfw);
      const yR = addFieldPair(doc, 'Officer Injuries', data.officer_injuries || 'None', rx, y, hfw);
      y = Math.max(yL, yR); }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Narrative
  y = addNarrativeSection(doc, 'Narrative', data.narrative || '', y, data.priority);
  y = addSupplementsSection(doc, data, y);

  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  y = addStackedSignatures(doc, 'Officer', '', y, getOfficerSig());
}

function generateDailyActivityReport(doc: jsPDF, data: IncidentData) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const gridX = getGridStartX();
  const gridW = getGridContentWidth(doc);

  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'DAILY ACTIVITY REPORT',
    formNumber: FORM_NUMBERS.daily_activity,
    caseNumber: data.incident_number,
    reportDate: data.occurred_date || data.created_at || '',
  });

  // ═══════════════════════════════════════════════════════════
  // ADMINISTRATIVE — officer + shift grid
  // ═══════════════════════════════════════════════════════════
  y = drawFormSection(doc, {
    sideTab: { label: 'SHIFT' },
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '1. OFFICER NAME', value: data.officer_name || '', ratio: 2, valueBold: true },
        { label: '2. SECTION', value: data.section_id || '', ratio: 1 },
        { label: '3. ZONE', value: data.zone_id || '', ratio: 1 },
        { label: '4. BEAT', value: data.beat_id || '', ratio: 1 },
      ]},
      { cells: [
        { label: '5. SHIFT DATE', value: data.occurred_date || '', ratio: 1 },
        { label: '6. SHIFT START', value: data.occurred_time || '', ratio: 1 },
        { label: '7. SHIFT END', value: data.end_time || '', ratio: 1 },
      ]},
    ],
    y,
  });

  // Officer / Shift Info
  { const sec = openAutoSection(doc, 'Officer / Shift Information', y); y = sec.contentY;
    { const yL = addFieldPair(doc, 'Officer', data.officer_name, lx, y, hfw);
      const yR = addFieldPair(doc, 'Sec/Zone/Beat', [data.section_id, data.zone_id, data.beat_id].filter(Boolean).join(' / ') || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    { const yL = addFieldPair(doc, 'Shift Date', data.occurred_date || '', lx, y, hfw);
      const yR = addFieldPair(doc, 'Shift Time', `${data.occurred_time || ''} -- ${data.end_time || ''}`, rx, y, hfw);
      y = Math.max(yL, yR); }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Activity Log
  { const sec = openAutoSection(doc, 'Activity Log', y); y = sec.contentY;
    doc.setFillColor(...COLOR.BG_TABLE_HDR);
    doc.rect(LAYOUT.PAGE_MARGIN + 1, y - 2, cw - 2, 7, 'F');
    doc.setDrawColor(...COLOR.BORDER_TABLE);
    doc.setLineWidth(BORDER.TABLE_ROW * 3);
    doc.line(LAYOUT.PAGE_MARGIN + 1, y + 5, LAYOUT.PAGE_MARGIN + cw - 1, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_TABLE_HEADER);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text('TIME', lx, y + 2);
    doc.text('ACTIVITY / LOCATION', LAYOUT.PAGE_MARGIN + 25, y + 2);
    doc.text('NOTES', LAYOUT.PAGE_MARGIN + 100, y + 2);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    y += 7;

    const tableTopY = y;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_TABLE_BODY);
    for (let i = 0; i < 6; i++) {
      if (i % 2 === 0) {
        doc.setFillColor(...COLOR.BG_ZEBRA);
        doc.rect(LAYOUT.PAGE_MARGIN + 1, y - 1, cw - 2, 7, 'F');
      }
      doc.setDrawColor(...COLOR.BORDER_TABLE);
      doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, pageWidth - LAYOUT.PAGE_MARGIN - SPACING.MD, y + 5);
      y += 7;
    }

    doc.setDrawColor(...COLOR.BORDER_COLUMN);
    doc.setLineWidth(BORDER.TABLE_COLUMN);
    doc.line(LAYOUT.PAGE_MARGIN + 23, tableTopY, LAYOUT.PAGE_MARGIN + 23, y - 2);
    doc.line(LAYOUT.PAGE_MARGIN + 98, tableTopY, LAYOUT.PAGE_MARGIN + 98, y - 2);

    doc.setDrawColor(...COLOR.TEXT_PRIMARY);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // GPS, Narrative, Attachments, Signatures
  y = addGpsActivityLogSection(doc, data, y, data.priority);
  y = addNarrativeSection(doc, 'Summary / Notes', data.narrative || '', y, data.priority);
  y = addSupplementsSection(doc, data, y);

  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  y = checkPageBreak(doc, y, 40, data.priority);
  y = addStackedSignatures(doc, 'Reporting Officer', '', y, getOfficerSig());
}

function generateArrestReport(doc: jsPDF, data: IncidentData) {
  const ffw = getFullFieldWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const gridX = getGridStartX();
  const gridW = getGridContentWidth(doc);

  const persons = data.linked_persons || [];
  const subj = persons[0] || { first_name: '', last_name: '', dob: '' };

  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'ARREST / DETENTION REPORT',
    formNumber: FORM_NUMBERS.arrest,
    caseNumber: data.incident_number,
    reportDate: data.occurred_date || data.created_at || '',
  });

  // Incident Info
  { const sec = openAutoSection(doc, 'Incident Information', y); y = sec.contentY;
    y = addFieldPair(doc, 'Location', data.location, lx, y, ffw);
    { const yL = addFieldPair(doc, 'Date', data.occurred_date || '', lx, y, hfw);
      const yR = addFieldPair(doc, 'Time', data.occurred_time || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Subject Details
  const subjectStartY = y;
  { const sec = openAutoSection(doc, 'Subject Details', y); y = sec.contentY;
    const persons = data.linked_persons || [];
    if (persons.length > 0) {
      const subj = persons[0];
      y = addThreeColumnFields(doc, [
        { label: 'Last Name', value: subj.last_name || '' },
        { label: 'First Name', value: subj.first_name || '' },
        { label: 'DOB', value: subj.dob || '' },
      ], y);
    } else {
      y = addThreeColumnFields(doc, [
        { label: 'Last Name', value: '' },
        { label: 'First Name', value: '' },
        { label: 'DOB', value: '' },
      ], y);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  y = drawFormGrid(doc, [
    { cells: [
      { label: '9. SUBJECT LAST NAME', value: subj.last_name || '', ratio: 2, valueBold: true },
      { label: '10. FIRST NAME', value: subj.first_name || '', ratio: 2, valueBold: true },
      { label: '11. DOB', value: subj.dob || '', ratio: 1 },
    ]},
  ], gridX, y, gridW);

  // Miranda block (full-width within grid)
  y = drawFormGrid(doc, [
    { cells: [
      { label: 'MIRANDA ADVISEMENT', value: 'You have the right to remain silent. Anything you say can and will be used against you. You have the right to an attorney. If you cannot afford one, one will be appointed.', ratio: 1 },
    ], height: 11 },
    { cells: [
      { label: '12. MIRANDA GIVEN AT', value: '', ratio: 1 },
      { label: '13. WAIVED / INVOKED', value: '', ratio: 1 },
    ]},
  ], gridX, y, gridW);

  // Arrest-specific flags
  const arrestFlags: CheckboxItem[] = [
    { label: 'Alcohol Involved', checked: !!data.alcohol_involved },
    { label: 'Drugs Involved', checked: !!data.drugs_involved },
    { label: 'Domestic Violence', checked: !!data.domestic_violence },
    { label: 'Gang Related', checked: !!data.gang_related },
    { label: 'Weapons', checked: !!data.weapons_involved },
    { label: 'Felony in Progress', checked: !!data.felony_in_progress },
    { label: 'Officer Safety', checked: !!data.officer_safety_caution },
    { label: 'Vehicle Pursuit', checked: !!data.vehicle_pursuit },
    { label: 'Foot Pursuit', checked: !!data.foot_pursuit },
    { label: 'BWC Active', checked: !!data.body_camera_active },
    { label: 'Evidence Collected', checked: !!data.evidence_collected },
    { label: 'Photos Taken', checked: !!data.photos_taken },
    { label: 'LE Notified', checked: !!data.le_notified },
  ];
  y = drawCheckboxGrid(doc, arrestFlags, gridX, y, 5, gridW);

  drawSideTab(doc, 'SUBJECT', subjectStartY, y - subjectStartY);
  y += SPACING.SECTION_GAP;

  // ═══════════════════════════════════════════════════════════
  // CHARGES — charges table
  // ═══════════════════════════════════════════════════════════
  const chargesStartY = y;
  y = checkPageBreak(doc, y, 30, data.priority);
  { const sec = openAutoSection(doc, 'Flags', y); y = sec.contentY;
    let flagX = lx;
    flagX = addCheckboxField(doc, 'Alcohol', !!data.alcohol_involved, flagX, y);
    flagX = addCheckboxField(doc, 'Drugs', !!data.drugs_involved, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'DV', !!data.domestic_violence, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Gang', !!data.gang_related, flagX + SPACING.SM, y);
    if (data.weapons_involved) {
      addCheckboxField(doc, 'Weapons: ' + data.weapons_involved, true, flagX + SPACING.SM, y);
    } else {
      addCheckboxField(doc, 'Weapons', false, flagX + SPACING.SM, y);
    }
    y += SPACING.LG; flagX = lx;
    flagX = addCheckboxField(doc, 'Felony IP', !!data.felony_in_progress, flagX, y);
    flagX = addCheckboxField(doc, 'Ofc Safety', !!data.officer_safety_caution, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Veh Pursuit', !!data.vehicle_pursuit, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Foot Pursuit', !!data.foot_pursuit, flagX + SPACING.SM, y);
    addCheckboxField(doc, 'BWC Active', !!data.body_camera_active, flagX + SPACING.SM, y);
    y += SPACING.LG; flagX = lx;
    flagX = addCheckboxField(doc, 'Evidence', !!data.evidence_collected, flagX, y);
    flagX = addCheckboxField(doc, 'Photos', !!data.photos_taken, flagX + SPACING.SM, y);
    addCheckboxField(doc, 'LE Notified', !!data.le_notified, flagX + SPACING.SM, y);
    y += SPACING.XL;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Charges table
  { const sec = openAutoSection(doc, 'Charges', y); y = sec.contentY;
    const colPositions = [lx, LAYOUT.PAGE_MARGIN + 90, LAYOUT.PAGE_MARGIN + 130];
    const tableHeaders = [
      { label: 'CHARGE', x: colPositions[0] },
      { label: 'CODE', x: colPositions[1] },
      { label: 'CLASS', x: colPositions[2] },
    ];
    const emptyRows: string[][] = [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']];
    y = addTableWithShading(doc, tableHeaders, emptyRows, y, colPositions);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  const chargeColPositions = [gridX, gridX + gridW * 0.55, gridX + gridW * 0.8];
  const chargeHeaders = [
    { label: 'CHARGE', x: chargeColPositions[0] },
    { label: 'STATUTE', x: chargeColPositions[1] },
    { label: 'CLASS', x: chargeColPositions[2] },
  ];
  const emptyChargeRows: string[][] = [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']];
  y = addTableWithShading(doc, chargeHeaders, emptyChargeRows, y, chargeColPositions);

  drawSideTab(doc, 'CHARGES', chargesStartY, y - chargesStartY);
  y += SPACING.SECTION_GAP;

  // ═══════════════════════════════════════════════════════════
  // PROPERTY — personal property inventory + codes
  // ═══════════════════════════════════════════════════════════
  const propStartY = y;
  y = checkPageBreak(doc, y, 30, data.priority);
  { const sec = openAutoSection(doc, 'Miranda Advisement', y); y = sec.contentY;
    doc.setFontSize(FONT.SIZE_TABLE_BODY);
    doc.setFont('helvetica', 'normal');
    doc.text('You have the right to remain silent. Anything you say can and will be used against you in a court of law.', lx, y);
    y += 4;
    doc.text('You have the right to an attorney. If you cannot afford an attorney, one will be appointed for you.', lx, y);
    y += SPACING.XL;
    { const yL = addFieldPair(doc, 'Miranda Given At', '', lx, y, hfw);
      const yR = addFieldPair(doc, 'Waived / Invoked', '', rx, y, hfw);
      y = Math.max(yL, yR); }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Personal Property Inventory
  y = checkPageBreak(doc, y, 30, data.priority);
  { const sec = openAutoSection(doc, 'Personal Property Inventory', y); y = sec.contentY;
    const colPositions = [lx, LAYOUT.PAGE_MARGIN + 20, LAYOUT.PAGE_MARGIN + 120];
    const tableHeaders = [
      { label: 'ITEM #', x: colPositions[0] },
      { label: 'DESCRIPTION', x: colPositions[1] },
      { label: 'DISPOSITION', x: colPositions[2] },
    ];
    const emptyRows: string[][] = [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']];
    y = addTableWithShading(doc, tableHeaders, emptyRows, y, colPositions);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  const propColPositions = [gridX, gridX + 15, gridX + gridW - 30];
  const propHeaders = [
    { label: 'ITEM #', x: propColPositions[0] },
    { label: 'DESCRIPTION', x: propColPositions[1] },
    { label: 'DISPOSITION', x: propColPositions[2] },
  ];
  const emptyPropRows: string[][] = [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']];
  y = addTableWithShading(doc, propHeaders, emptyPropRows, y, propColPositions);

  drawSideTab(doc, 'PROPERTY', propStartY, y - propStartY);
  y += SPACING.SECTION_GAP;

  // ═══════════════════════════════════════════════════════════
  // FREE-FORM — GPS, Narrative, Attachments, Signatures
  // ═══════════════════════════════════════════════════════════

  y = addGpsActivityLogSection(doc, data, y, data.priority);
  y = addNarrativeSection(doc, 'Narrative', data.narrative || '', y, data.priority);
  y = addSupplementsSection(doc, data, y);

  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  y = checkPageBreak(doc, y, 40, data.priority);
  y = addStackedSignatures(doc, 'Arresting Officer', '', y, getOfficerSig());
}

// ── Process Service Report ────────────────────────────────────

function generateProcessServiceReport(doc: jsPDF, data: IncidentData) {
  const ffw = getFullFieldWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const gridX = getGridStartX();
  const gridW = getGridContentWidth(doc);

  const serviceTypeLabel = (data.process_service_type || '').replace(/_/g, ' ').toUpperCase() || 'GENERAL';

  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'PROCESS SERVICE REPORT',
    formNumber: FORM_NUMBERS.incident,
    caseNumber: data.incident_number,
    reportDate: data.occurred_date || data.created_at || '',
  });

  // Classification
  { const sec = openAutoSection(doc, 'Classification', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Incident Number', value: data.incident_number },
      { label: 'Priority', value: data.priority },
      { label: 'Status', value: data.status?.toUpperCase() || '' },
      { label: 'Disposition', value: data.disposition || '' },
      { label: 'Service Type', value: serviceTypeLabel },
      { label: 'Contract ID', value: data.contract_id || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Client / Requestor Information
  y = checkPageBreak(doc, y, 30, data.priority);
  { const sec = openAutoSection(doc, 'Client / Requestor Information', y); y = sec.contentY;
    { const yL = addFieldPair(doc, 'Requestor Name', data.pso_requestor_name || '', lx, y, hfw);
      const yR = addFieldPair(doc, 'Requestor Phone', data.pso_requestor_phone || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    { const yL = addFieldPair(doc, 'Requestor Email', data.pso_requestor_email || '', lx, y, hfw);
      const yR = addFieldPair(doc, 'Billing Code', data.pso_billing_code || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    { const yL = addFieldPair(doc, 'Authorization / PO#', data.pso_authorization || '', lx, y, hfw);
      const yR = addFieldPair(doc, 'PSO Service Type', (data.pso_service_type || '').replace(/_/g, ' ').toUpperCase(), rx, y, hfw);
      y = Math.max(yL, yR); }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Service of Process Details
  y = checkPageBreak(doc, y, 35, data.priority);
  { const sec = openAutoSection(doc, 'Service of Process Details', y); y = sec.contentY;
    { const yL = addFieldPair(doc, 'Document Type', serviceTypeLabel, lx, y, hfw);
      const yR = addFieldPair(doc, 'Serve To (Name)', data.process_served_to || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    y = addFieldPair(doc, 'Service Address', data.process_served_address || data.location || '', lx, y, ffw);
    { const yL = addFieldPair(doc, 'Attempts Made', String(data.process_attempts || 0), lx, y, hfw);
      const yR = addFieldPair(doc, 'Served At', data.process_served_at || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    y = addFieldPair(doc, 'Service Result', (data.process_service_result || '').replace(/_/g, ' ').toUpperCase(), lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Officer / Location — single row, 5 columns
  y = checkPageBreak(doc, y, 18, data.priority);
  { const sec = openAutoSection(doc, 'Officer / Location', y); y = sec.contentY;
    const olFields = [
      { label: 'Officer', value: data.officer_name || '' },
      { label: 'Location', value: data.location || '' },
      { label: 'Section ID', value: data.section_id || '' },
      { label: 'Zone ID', value: data.zone_id || '' },
      { label: 'Beat ID', value: data.beat_id || '' },
    ];
    const olRatios = [2, 3, 1, 1, 1]; // Officer wider, Location widest, IDs narrow
    const olTotal = olRatios.reduce((a, b) => a + b, 0);
    let maxOLY = y + SPACING.FIELD_ROW_ADVANCE;
    let olX = lx;
    for (let i = 0; i < 5; i++) {
      const colW = (ffw * olRatios[i]) / olTotal;
      const fy = addFieldPair(doc, olFields[i].label, olFields[i].value, olX, y, colW);
      if (fy > maxOLY) maxOLY = fy;
      olX += colW;
    }
    y = maxOLY;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Date / Time — all 4 fields on one row
  y = checkPageBreak(doc, y, 18, data.priority);
  { const sec = openAutoSection(doc, 'Date / Time', y); y = sec.contentY;
    const dtW = ffw / 4;
    const dtFields = [
      { label: 'Occurred Date', value: data.occurred_date || '' },
      { label: 'Occurred Time', value: data.occurred_time || '' },
      { label: 'End Date', value: data.end_date || '' },
      { label: 'End Time', value: data.end_time || '' },
    ];
    let maxDTY = y + SPACING.FIELD_ROW_ADVANCE;
    for (let i = 0; i < 4; i++) {
      const fy = addFieldPair(doc, dtFields[i].label, dtFields[i].value, lx + i * dtW, y, dtW);
      if (fy > maxDTY) maxDTY = fy;
    }
    y = maxDTY;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Flags — evenly spaced across full width
  y = checkPageBreak(doc, y, 18, data.priority);
  { const sec = openAutoSection(doc, 'Flags', y); y = sec.contentY;
    y += 1;
    const flagItems = [
      { label: 'Evidence', checked: !!data.evidence_collected },
      { label: 'BWC Active', checked: !!data.body_camera_active },
      { label: 'Photos', checked: !!data.photos_taken },
      { label: 'LE Notified', checked: !!data.le_notified },
      { label: 'Supvr Notified', checked: !!data.supervisor_notified },
    ];
    const flagColW = ffw / flagItems.length;
    for (let i = 0; i < flagItems.length; i++) {
      addCheckboxField(doc, flagItems[i].label, flagItems[i].checked, lx + i * flagColW, y);
    }
    y += 4;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Narrative
  y = addNarrativeSection(doc, 'Narrative / Service Notes', data.narrative || '', y, data.priority);
  y = addSupplementsSection(doc, data, y);

  // Linked Persons
  if (data.linked_persons && data.linked_persons.length > 0) {
    y = checkPageBreak(doc, y, 25, data.priority);
    const sec = openAutoSection(doc, 'Linked Persons', y); y = sec.contentY;
    const colPositions = [gridX, gridX + 50, gridX + 100];
    const tableHeaders = [
      { label: 'NAME', x: colPositions[0] },
      { label: 'ROLE', x: colPositions[1] },
      { label: 'DOB', x: colPositions[2] },
    ];
    const rows = data.linked_persons.map(p => [
      `${p.last_name}, ${p.first_name}`,
      p.role,
      p.dob || '',
    ]);
    y = addTableWithShading(doc, tableHeaders, rows, y, colPositions);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / SERVICE DOCUMENTS', data.priority);
  }

  // Signatures — addStackedSignatures has its own checkPageBreak internally
  y = addStackedSignatures(doc, 'Process Server / Officer', '', y, getOfficerSig(), undefined, data.priority);
}

// ── Public API ───────────────────────────────────────────────

export function generatePdfReport(reportType: PdfReportType, data: IncidentData): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  setActiveFormKey(reportType);
  setActiveCaseNumber(data.incident_number);

  generationTimestamp = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  addConfidentialWatermark(doc);
  // @ts-expect-error jsPDF GState — safety reset after watermark
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  switch (reportType) {
    case 'incident':
      generateGeneralIncident(doc, data);
      break;
    case 'trespass':
      generateTrespassWarning(doc, data);
      break;
    case 'accident':
      generateAccidentReport(doc, data);
      break;
    case 'medical':
      generateMedicalReport(doc, data);
      break;
    case 'use_of_force':
      generateUseOfForceReport(doc, data);
      break;
    case 'daily_activity':
      generateDailyActivityReport(doc, data);
      break;
    case 'arrest':
      generateArrestReport(doc, data);
      break;
    case 'process_service':
      generateProcessServiceReport(doc, data);
      break;
    default:
      generateGeneralIncident(doc, data);
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, totalPages);
    if (i > 1) {
      addConfidentialWatermark(doc);
    }
  }

  return doc;
}

/** Download PDF — async to fetch admin branding + seal before generating */
export async function downloadPdfReport(reportType: PdfReportType, data: IncidentData) {
  try {
    const branding = await fetchPdfBranding();
    setActiveBranding(branding);
    await loadPdfAssets();

    // Extract officer digital signature from enriched data
    const anyData = data as any;
    if (anyData._officerSignature) {
      setActiveOfficerSig({
        signatureImage: anyData._officerSignature,
        printedName: anyData.officer_name || '',
        badgeNumber: anyData.badge_number || '',
      });
    } else {
      setActiveOfficerSig(undefined);
    }

    const doc = generatePdfReport(reportType, data);
    setActiveOfficerSig(undefined);
    const filename = `${data.incident_number || 'report'}_${reportType}.pdf`;
    doc.save(filename);
  } catch (err) {
    setActiveOfficerSig(undefined);
    console.error('PDF generation failed:', err);
    throw new Error(`Failed to generate ${reportType} PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

/** Generate incident report PDF and return a blob URL for in-app preview */
export async function generatePdfReportBlobUrl(reportType: PdfReportType, data: IncidentData): Promise<string> {
  try {
    const branding = await fetchPdfBranding();
    setActiveBranding(branding);
    await loadPdfAssets();

    // Extract officer digital signature from enriched data
    const anyData = data as any;
    if (anyData._officerSignature) {
      setActiveOfficerSig({
        signatureImage: anyData._officerSignature,
        printedName: anyData.officer_name || '',
        badgeNumber: anyData.badge_number || '',
      });
    } else {
      setActiveOfficerSig(undefined);
    }

    const doc = generatePdfReport(reportType, data);
    setActiveOfficerSig(undefined);
    const blob = doc.output('blob');
    return URL.createObjectURL(blob);
  } catch (err) {
    setActiveOfficerSig(undefined);
    console.error('PDF preview generation failed:', err);
    throw new Error(`Failed to generate ${reportType} PDF preview: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}
