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
} from './pdfTokens';

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
  primary_color: '#bc1010',
  accent_color: '#d4a017',
  header_bg_color: '#000000',
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
  critical: { bg: [188, 16, 16], text: [255, 255, 255], label: 'PRIORITY: CRITICAL' },
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

  doc.saveGraphicsState();
  // @ts-expect-error jsPDF GState — more visible watermark (0.08 opacity)
  doc.setGState(new doc.GState({ opacity: 0.08 }));
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLOR.WATERMARK);

  const cx = pageWidth / 2;
  const cy = pageHeight / 2;
  doc.setFontSize(FONT.SIZE_WATERMARK_LARGE);
  doc.text('CONFIDENTIAL', cx, cy, { align: 'center', angle: 45 });
  doc.restoreGraphicsState();

  // Explicitly reset opacity to full after watermark (jsPDF GState safety)
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

  // ── Header background bar ──────────────────────────────
  doc.setFillColor(headerBg[0], headerBg[1], headerBg[2]);
  doc.rect(LAYOUT.PAGE_MARGIN, LAYOUT.HEADER_TOP, cw, LAYOUT.HEADER_HEIGHT, 'F');

  // ── Seal / Logo image (left) ───────────────────────────
  const sealX = LAYOUT.PAGE_MARGIN + SPACING.SM + 0.5;
  const sealY = LAYOUT.HEADER_TOP + (LAYOUT.HEADER_HEIGHT - LAYOUT.SEAL_SIZE) / 2;
  let textStartX = LAYOUT.PAGE_MARGIN + SPACING.XL;

  const imageToUse = useLogo && cachedLogoDark ? cachedLogoDark : cachedSeal;

  if (imageToUse) {
    try {
      if (useLogo && cachedLogoDark) {
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(sealX - 0.3, sealY - 0.3, LAYOUT.SEAL_SIZE + 0.6, LAYOUT.SEAL_SIZE + 0.6, 1, 1, 'F');
      }
      doc.addImage(imageToUse, 'PNG', sealX, sealY, LAYOUT.SEAL_SIZE, LAYOUT.SEAL_SIZE);
      textStartX = sealX + LAYOUT.SEAL_SIZE + SPACING.MD;
    } catch {
      textStartX = LAYOUT.PAGE_MARGIN + SPACING.XL;
    }
  }

  // ── Line 1: Agency name ────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_HEADER_TITLE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text(agencyName || brand.report_header_text, textStartX, LAYOUT.HEADER_TOP + 6.5);

  // ── Line 2: Subheader + report type ────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_SUBHEADER);
  doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
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
  doc.setTextColor(150, 150, 150);
  doc.text(metaParts.join('  |  '), textStartX, LAYOUT.HEADER_TOP + 15);

  // ── Priority badge (inline, below report meta) ─────────
  const prio = PRIORITY_COLORS[priority?.toLowerCase()];
  if (prio) {
    const prioLabel = prio.label.replace('PRIORITY: ', '');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5);
    const prioW = doc.getTextWidth(prioLabel) + 4;
    const prioX = textStartX;
    const prioY = LAYOUT.HEADER_TOP + 16.5;
    doc.setFillColor(prio.bg[0], prio.bg[1], prio.bg[2]);
    doc.roundedRect(prioX, prioY, prioW, 3, 0.5, 0.5, 'F');
    doc.setTextColor(prio.text[0], prio.text[1], prio.text[2]);
    doc.text(prioLabel, prioX + prioW / 2, prioY + 2.2, { align: 'center' });
  }

  // ── Case number box (right) ────────────────────────────
  const caseBoxH = LAYOUT.HEADER_HEIGHT - 2;
  const caseBoxX = pageWidth - LAYOUT.PAGE_MARGIN - LAYOUT.CASE_BOX_W - SPACING.SM;
  const caseBoxY = LAYOUT.HEADER_TOP + 1;

  doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.rect(caseBoxX, caseBoxY, LAYOUT.CASE_BOX_W, caseBoxH, 'F');

  // Label
  doc.setFontSize(FONT.SIZE_SMALL_META);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text(caseBoxLabel, caseBoxX + LAYOUT.CASE_BOX_W / 2, caseBoxY + 5, { align: 'center' });

  // Case number value
  doc.setFontSize(FONT.SIZE_CASE_NUMBER);
  doc.setFont('courier', 'bold');
  doc.text(caseNumber, caseBoxX + LAYOUT.CASE_BOX_W / 2, caseBoxY + 12, { align: 'center' });

  // ── Thin accent line below header ──────────────────────
  const stripY = LAYOUT.HEADER_TOP + LAYOUT.HEADER_HEIGHT;
  doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.rect(LAYOUT.PAGE_MARGIN, stripY, cw * 0.4, LAYOUT.ACCENT_STRIP_H, 'F');
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.rect(LAYOUT.PAGE_MARGIN + cw * 0.4, stripY, cw * 0.6, LAYOUT.ACCENT_STRIP_H, 'F');

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
export function openAutoSection(doc: jsPDF, title: string, y: number): { contentY: number; sectionY: number } {
  const cw = getContentWidth(doc);

  // Ensure full opacity (safety reset after watermark GState)
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  // Dark header bar with white text (police report blocky style)
  doc.setFillColor(...COLOR.BG_SECTION_HDR);
  doc.rect(LAYOUT.PAGE_MARGIN, y, cw, SPACING.SECTION_HEADER_H, 'F');
  // Bold border around header
  doc.setDrawColor(...COLOR.BORDER_SECTION);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.rect(LAYOUT.PAGE_MARGIN, y, cw, SPACING.SECTION_HEADER_H);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_SECTION_TITLE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text(title.toUpperCase(), LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET + 1, y + 4.2);

  doc.setFont('helvetica', 'normal');

  // Content starts after header bar + content padding (not tight against bar)
  return { contentY: y + SPACING.SECTION_HEADER_H + SPACING.SECTION_CONTENT_PAD, sectionY: y };
}

/**
 * Close an auto-sizing section — draws thin border from sectionY to contentEndY.
 */
export function closeAutoSection(doc: jsPDF, sectionY: number, contentEndY: number, padding = SPACING.SECTION_BOTTOM_PAD): number {
  const cw = getContentWidth(doc);
  const totalHeight = (contentEndY - sectionY) + padding;

  // Clean dark border around entire section (header + content)
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.rect(LAYOUT.PAGE_MARGIN, sectionY, cw, Math.max(totalHeight, 12));

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
export function addFieldPair(doc: jsPDF, label: string, value: string, x: number, y: number, width: number): number {
  // @ts-expect-error jsPDF GState — ensure full opacity
  doc.setGState(new doc.GState({ opacity: 1.0 }));
  const labelH = 3;          // Height reserved for floating label above box
  const baseBoxH = 7;        // Minimum value box height (tight)
  const innerPad = 1.5;      // Horizontal padding inside box
  const maxW = width - 2 * innerPad;
  const lineStep = 3.5;      // Y-step per extra line of value text
  const maxLines = 4;        // Cap at 4 lines

  // Floating label above the box
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(label.toUpperCase(), x + innerPad, y + 2);

  // Determine value text and line count — Courier for values (police typewriter style)
  doc.setFont('courier', 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);

  const isEmpty = !value || value.trim() === '';
  const displayText = isEmpty ? '\u2014' : value;
  const lines: string[] = isEmpty
    ? [displayText]
    : doc.splitTextToSize(displayText, maxW).slice(0, maxLines);
  const extraLines = Math.max(0, lines.length - 1);
  const boxH = baseBoxH + extraLines * lineStep;

  // Value box with border (positioned below the label) — blocky grid
  const boxY = y + labelH;
  doc.setDrawColor(...COLOR.BORDER_FIELD);
  doc.setLineWidth(BORDER.FIELD);
  doc.rect(x, boxY, width, boxH);

  // Value text vertically centered in box (Courier)
  const valColor = isEmpty ? COLOR.TEXT_TERTIARY : COLOR.TEXT_PRIMARY;
  doc.setTextColor(valColor[0], valColor[1], valColor[2]);

  const textStartY = boxY + 4.5;
  let lineY = textStartY;
  for (const line of lines) {
    doc.text(line, x + innerPad, lineY);
    lineY += lineStep;
  }

  // Reset text color
  doc.setTextColor(...COLOR.TEXT_PRIMARY);

  return y + labelH + boxH + 1; // label + box + gap between rows
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

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_CHECKBOX_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(label, x + boxSize + 1.5, y);

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  return x + boxSize + 1.5 + doc.getTextWidth(label) + 3;
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
 * Government-style signature block with shaded role header,
 * signature line with X marker, and grid sub-fields.
 * Optionally embeds a digital signature image and pre-fills name/badge/date.
 */
export function addSignatureBlock(
  doc: jsPDF,
  roleLabel: string,
  x: number,
  y: number,
  width: number,
  sigData?: PdfSignatureData,
): number {
  // @ts-expect-error jsPDF GState — ensure full opacity
  doc.setGState(new doc.GState({ opacity: 1.0 }));
  const boxH = SPACING.SIGNATURE_BOX_H;

  // Outer border — black to match section style
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.rect(x, y, width, boxH);

  // Role label in dark header bar with white text
  const roleBarH = SPACING.SIGNATURE_ROLE_H;
  doc.setFillColor(...COLOR.BG_SECTION_HDR);
  doc.rect(x, y, width, roleBarH, 'F');
  doc.setDrawColor(...COLOR.BORDER_SECTION);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.line(x, y + roleBarH, x + width, y + roleBarH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text(roleLabel.toUpperCase(), x + SPACING.CONTENT_INSET, y + 3.8);

  // Signature area
  const sigLineY = y + roleBarH + 10;

  // Embed digital signature image if provided
  if (sigData?.signatureImage) {
    try {
      const imgW = width - SPACING.MD * 2 - 10;
      const imgH = 10;
      doc.addImage(sigData.signatureImage, 'PNG', x + SPACING.MD + 5, y + roleBarH + 1, imgW, imgH);
    } catch { /* signature image unavailable — fall back to empty line */ }
  }

  // Signature line
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setLineWidth(BORDER.SIGNATURE_LINE);
  doc.line(x + SPACING.MD, sigLineY, x + width - SPACING.MD, sigLineY);

  if (!sigData?.signatureImage) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_SIGNATURE_X);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text('X', x + SPACING.CONTENT_INSET, sigLineY - 1.5);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('SIGNATURE', x + FONT.SIZE_SIGNATURE_X + 1, sigLineY + 3);

  // Bottom row: PRINTED NAME | BADGE # | DATE
  const subY = sigLineY + SPACING.SIGNATURE_SUB_GAP;
  const colW = (width - SPACING.SM) / 3;

  doc.setDrawColor(...COLOR.BORDER_FIELD);
  doc.setLineWidth(BORDER.FIELD);
  doc.line(x, subY, x + width, subY);
  doc.line(x + colW, subY, x + colW, y + boxH);
  doc.line(x + colW * 2, subY, x + colW * 2, y + boxH);

  // Sub-field labels
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('PRINTED NAME', x + SPACING.MD, subY + 3.5);
  doc.text('BADGE NUMBER', x + colW + SPACING.MD, subY + 3.5);
  doc.text('DATE', x + colW * 2 + SPACING.MD, subY + 3.5);

  // Fill in values if provided
  if (sigData?.printedName || sigData?.badgeNumber || sigData?.date) {
    doc.setFont('courier', 'normal');
    doc.setFontSize(FONT.SIZE_FIELD_VALUE);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    const valY = subY + 7.5;
    if (sigData.printedName) doc.text(sigData.printedName, x + SPACING.MD, valY);
    if (sigData.badgeNumber) doc.text(sigData.badgeNumber, x + colW + SPACING.MD, valY);
    const dateStr = sigData.date || new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    doc.text(dateStr, x + colW * 2 + SPACING.MD, valY);
  } else {
    // Empty lines for manual signing
    doc.setDrawColor(...COLOR.BORDER_FIELD);
    doc.setLineWidth(BORDER.FIELD);
    const lineYSub = subY + 7;
    doc.line(x + SPACING.MD, lineYSub, x + colW - SPACING.MD, lineYSub);
    doc.line(x + colW + SPACING.MD, lineYSub, x + colW * 2 - SPACING.MD, lineYSub);
    doc.line(x + colW * 2 + SPACING.MD, lineYSub, x + width - SPACING.MD, lineYSub);
  }

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + boxH + SPACING.LG;
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

  // Accent bar at footer top (matches header accent strip)
  const barY = pageHeight - LAYOUT.FOOTER_HEIGHT - SPACING.SM;
  doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.rect(LAYOUT.PAGE_MARGIN, barY, cw * 0.4, 0.6, 'F');
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.rect(LAYOUT.PAGE_MARGIN + cw * 0.4, barY, cw * 0.6, 0.6, 'F');

  const textY = barY + 4;

  // Left: Form # | Rev
  doc.setFont('courier', 'normal');
  doc.setFontSize(FONT.SIZE_FOOTER_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  if (formNum) {
    doc.text(`${formNum}  |  ${FORM_REVISION}`, LAYOUT.PAGE_MARGIN, textY);
  }

  // Center: INTERNAL USE ONLY
  doc.setFont('helvetica', 'bold');
  doc.text('INTERNAL USE ONLY', pageWidth / 2, textY, { align: 'center' });

  // Right: Page X of Y
  doc.setFont('courier', 'normal');
  doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - LAYOUT.PAGE_MARGIN, textY, { align: 'right' });
}

/**
 * Wrapped text with paragraph detection and internal page break checking.
 * Double-newlines (\n\n) create paragraph breaks with extra spacing.
 * Single newlines are treated as hard line breaks within a paragraph.
 */
export function addWrappedText(doc: jsPDF, text: string, x: number, y: number, maxWidth: number, fontSize: number = FONT.SIZE_FIELD_VALUE): number {
  if (!text) return y;
  doc.setFont('courier', 'normal');
  doc.setFontSize(fontSize);
  const lineH = fontSize * 0.42 + 1.2;
  const paragraphGap = SPACING.MD; // Extra space between paragraphs

  // Split on double-newlines for paragraph breaks
  const paragraphs = text.split(/\n\n+/);

  for (let p = 0; p < paragraphs.length; p++) {
    if (p > 0) y += paragraphGap; // Paragraph spacing

    const para = paragraphs[p].trim();
    if (!para) continue;

    const lines: string[] = doc.splitTextToSize(para, maxWidth);
    for (const line of lines) {
      y = checkPageBreak(doc, y, lineH + SPACING.SM);
      doc.text(line, x, y);
      y += lineH;
    }
  }

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
  text: string,
  y: number,
  priority?: string,
): number {
  if (!text) return y;
  y = checkPageBreak(doc, y, 30, priority);
  const sec = openAutoSection(doc, title, y);
  y = sec.contentY;

  // Subtle background tint behind narrative text for visual separation
  const lx = getLeftX();
  const ffw = getFullFieldWidth(doc);
  doc.setFillColor(246, 246, 250);
  doc.rect(lx - 2, y - 2, ffw + 4, 10, 'F'); // Initial tint (content expands)

  doc.setFont('courier', 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  y = addWrappedText(doc, text, lx, y, ffw);
  y += SPACING.SM;
  y = closeAutoSection(doc, sec.sectionY, y);
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
  const aspect = image.width / image.height;
  let renderW = maxWidth;
  let renderH = renderW / aspect;
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
  y = closeAutoSection(doc, sec.sectionY, y);
  return y;
}

/**
 * Page break with continuation header on new pages.
 */
export function checkPageBreak(doc: jsPDF, y: number, needed: number, priority?: string): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - LAYOUT.FOOTER_HEIGHT - 12) {
    doc.addPage();
    addConfidentialWatermark(doc);

    const pageWidth = doc.internal.pageSize.getWidth();
    const cw = getContentWidth(doc);

    const contY = 8;
    // Continuation bar with accent edge — matches section headers (light bg + dark text)
    const contAccent = hexToRgb(activeBranding.primary_color);
    doc.setFillColor(contAccent[0], contAccent[1], contAccent[2]);
    doc.rect(LAYOUT.PAGE_MARGIN, contY, 2, SPACING.SECTION_HEADER_H, 'F');
    doc.setFillColor(...COLOR.BG_SECTION_HDR);
    doc.rect(LAYOUT.PAGE_MARGIN + 2, contY, cw - 2, SPACING.SECTION_HEADER_H, 'F');
    // Bottom border for definition
    doc.setDrawColor(...COLOR.BORDER_SECTION);
    doc.setLineWidth(BORDER.SECTION_OUTER);
    doc.line(LAYOUT.PAGE_MARGIN, contY + SPACING.SECTION_HEADER_H, LAYOUT.PAGE_MARGIN + cw, contY + SPACING.SECTION_HEADER_H);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(`${activeBranding.report_header_text} \u2014 CONTINUED`, LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET, contY + 5.8);

    // Form number + case number on right
    const rightParts: string[] = [];
    const formNum = FORM_NUMBERS[activeFormKey] || '';
    if (formNum) rightParts.push(formNum);
    if (activeCaseNumber) rightParts.push(activeCaseNumber);
    if (rightParts.length > 0) {
      doc.text(rightParts.join('  |  '), pageWidth - LAYOUT.PAGE_MARGIN - SPACING.CONTENT_INSET, contY + 5.8, { align: 'right' });
    }

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.setDrawColor(...COLOR.TEXT_PRIMARY);

    // No priority bar on continuation pages — just start content below continuation header
    return contY + SPACING.SECTION_HEADER_H + SPACING.SECTION_CONTENT_PAD;
  }
  return y;
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
): number {
  // @ts-expect-error jsPDF GState — ensure full opacity
  doc.setGState(new doc.GState({ opacity: 1.0 }));
  const cw = getContentWidth(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const minRowH = 6;
  const cellLineH = 3.8;      // Line height within table cells
  const cellPad = 2;           // Padding inside cells
  const maxCellLines = 5;     // Cap per cell to prevent runaway heights

  // Pre-compute column widths from position deltas
  const colWidths: number[] = [];
  for (let c = 0; c < colPositions.length; c++) {
    const nextX = c + 1 < colPositions.length ? colPositions[c + 1] - 2 : pageW - LAYOUT.PAGE_MARGIN - 1;
    colWidths.push(nextX - colPositions[c] - cellPad);
  }

  // Helper to draw header row — dark blocky style
  const drawHeaders = (atY: number): number => {
    const headerRowH = 8;
    // Dark table header (police report style)
    doc.setFillColor(...COLOR.BG_TABLE_HDR);
    doc.rect(LAYOUT.PAGE_MARGIN + 1, atY - 3, cw - 2, headerRowH, 'F');
    // Bold border around header
    doc.setDrawColor(...COLOR.BORDER_OUTER);
    doc.setLineWidth(BORDER.TABLE_OUTER);
    doc.rect(LAYOUT.PAGE_MARGIN + 1, atY - 3, cw - 2, headerRowH);

    doc.setFontSize(FONT.SIZE_TABLE_HEADER);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    for (const h of headers) {
      doc.text(h.label, h.x, atY + 0.5);
    }
    return atY + headerRowH;
  };

  let y = drawHeaders(startY);
  const tableTop = startY - 3;

  // Track vertical segment boundaries for column borders
  const colSegments: { top: number; bottom: number }[] = [{ top: tableTop, bottom: y }];
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
      const cellText = row[c] || '';
      const availW = colWidths[c] || 30;
      const lines = cellText ? doc.splitTextToSize(cellText, availW).slice(0, maxCellLines) : [''];
      cellLines.push(lines);
      if (lines.length > maxLines) maxLines = lines.length;
    }
    const rowH = Math.max(minRowH, maxLines * cellLineH + 2);

    // Check page break before each row — re-draw headers on new page
    const prevPage = doc.getNumberOfPages();
    y = checkPageBreak(doc, y, rowH + SPACING.SM);
    if (doc.getNumberOfPages() > prevPage) {
      // Close previous segment and start new one after page break
      colSegments[colSegments.length - 1].bottom = y - rowH;
      y = drawHeaders(y);
      currentSegTop = y;
      colSegments.push({ top: currentSegTop - 1, bottom: y });
      doc.setFont('courier', 'normal');
      doc.setFontSize(FONT.SIZE_TABLE_BODY);
    }

    // Zebra shading with dynamic height
    if (i % 2 === 0) {
      doc.setFillColor(...COLOR.BG_ZEBRA);
      doc.rect(LAYOUT.PAGE_MARGIN + 1, y - 3, cw - 2, rowH, 'F');
    }

    // Row separator at bottom of row
    doc.setDrawColor(...COLOR.BORDER_TABLE);
    doc.setLineWidth(BORDER.TABLE_ROW);
    doc.line(LAYOUT.PAGE_MARGIN + 1, y + rowH - 3, LAYOUT.PAGE_MARGIN + cw - 1, y + rowH - 3);

    // Render cell text (multi-line)
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    for (let c = 0; c < cellLines.length; c++) {
      const lines = cellLines[c];
      let cellY = y;
      for (const line of lines) {
        doc.text(line, colPositions[c], cellY);
        cellY += cellLineH;
      }
    }

    y += rowH;
  }

  // Update final segment bottom
  colSegments[colSegments.length - 1].bottom = y - 1;

  // Vertical column borders (drawn per segment to handle page breaks)
  doc.setDrawColor(...COLOR.BORDER_COLUMN);
  doc.setLineWidth(BORDER.TABLE_COLUMN);
  for (const seg of colSegments) {
    for (let c = 1; c < colPositions.length; c++) {
      const sepX = colPositions[c] - 2;
      doc.line(sepX, seg.top, sepX, seg.bottom);
    }
  }

  // Outer border (main page segment only — first segment)
  doc.setDrawColor(...COLOR.BORDER_OUTER);
  doc.setLineWidth(BORDER.TABLE_OUTER);
  const tableBottom = y - 1;
  doc.rect(LAYOUT.PAGE_MARGIN + 1, tableTop, cw - 2, tableBottom - tableTop + 1);

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
}

// ── Report Templates ─────────────────────────────────────────

function generateGeneralIncident(doc: jsPDF, data: IncidentData) {
  const hw = getHalfWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const cw = getContentWidth(doc);


  let y = addReportHeader(doc, data.incident_number, 'General Incident Report', data.priority, undefined, { useLogo: true });

  // Classification
  { const sec = openAutoSection(doc, 'Classification', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Incident Type', value: formatIncidentType(data.incident_type) },
      { label: 'Type Code', value: getTypeCode(data.incident_type) },
      { label: 'Priority', value: data.priority },
      { label: 'Status', value: data.status?.toUpperCase() || '' },
      { label: 'Disposition', value: data.disposition || '' },
      { label: 'Section ID', value: data.section_id || '' },
      { label: 'Zone ID', value: data.zone_id || '' },
      { label: 'Beat ID', value: data.beat_id || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Officer & Location
  { const sec = openAutoSection(doc, 'Officer / Location', y); y = sec.contentY;
    addFieldPair(doc, 'Officer', data.officer_name, lx, y, hfw);
    y = addFieldPair(doc, 'Location', data.location, rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Date/Time — 2×2 layout (less cramped than 4-column)
  { const sec = openAutoSection(doc, 'Date / Time', y); y = sec.contentY;
    const hw = getHalfFieldWidth(doc);
    const rx = getRightColumnX(doc);
    addFieldPair(doc, 'Occurred Date', data.occurred_date || '', lx, y, hw);
    y = addFieldPair(doc, 'Occurred Time', data.occurred_time || '', rx, y, hw);
    addFieldPair(doc, 'End Date', data.end_date || '', lx, y, hw);
    y = addFieldPair(doc, 'End Time', data.end_time || '', rx, y, hw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Scene Details
  { const sec = openAutoSection(doc, 'Scene Details', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Weather', value: data.weather_conditions || '' },
      { label: 'Lighting', value: data.lighting_conditions || '' },
      { label: 'Injuries', value: `${data.injuries || 'None'}${data.injury_description ? ' \u2014 ' + data.injury_description : ''}` },
      { label: 'Damage', value: `${data.damage_estimate ? '$' + data.damage_estimate : ''}${data.damage_description ? ' \u2014 ' + data.damage_description : ''}` },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Flags
  y = checkPageBreak(doc, y, 30, data.priority);
  { const sec = openAutoSection(doc, 'Flags', y); y = sec.contentY;
    let flagX = lx;
    flagX = addCheckboxField(doc, 'Injuries', !!data.injuries_reported, flagX, y);
    flagX = addCheckboxField(doc, 'Alcohol', !!data.alcohol_involved, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Drugs', !!data.drugs_involved, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'DV', !!data.domestic_violence, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Mental Health', !!data.mental_health_crisis, flagX + SPACING.SM, y);
    addCheckboxField(doc, 'Juvenile', !!data.juvenile_involved, flagX + SPACING.SM, y);
    y += SPACING.LG; flagX = lx;
    flagX = addCheckboxField(doc, 'Felony IP', !!data.felony_in_progress, flagX, y);
    flagX = addCheckboxField(doc, 'Ofc Safety', !!data.officer_safety_caution, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Gang', !!data.gang_related, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'HAZMAT', !!data.hazmat, flagX + SPACING.SM, y);
    if (data.weapons_involved) {
      addCheckboxField(doc, 'Weapons: ' + data.weapons_involved, true, flagX + SPACING.SM, y);
    } else {
      addCheckboxField(doc, 'Weapons', false, flagX + SPACING.SM, y);
    }
    y += SPACING.LG; flagX = lx;
    flagX = addCheckboxField(doc, 'K9 Req', !!data.k9_requested, flagX, y);
    flagX = addCheckboxField(doc, 'EMS Req', !!data.ems_requested, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Fire Req', !!data.fire_requested, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'BWC Active', !!data.body_camera_active, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Evidence', !!data.evidence_collected, flagX + SPACING.SM, y);
    addCheckboxField(doc, 'Photos', !!data.photos_taken, flagX + SPACING.SM, y);
    y += SPACING.LG; flagX = lx;
    flagX = addCheckboxField(doc, 'Supvr Notified', !!data.supervisor_notified, flagX, y);
    flagX = addCheckboxField(doc, 'LE Notified', !!data.le_notified, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Trespass', !!data.trespass_issued, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Veh Pursuit', !!data.vehicle_pursuit, flagX + SPACING.SM, y);
    addCheckboxField(doc, 'Foot Pursuit', !!data.foot_pursuit, flagX + SPACING.SM, y);
    y += SPACING.XL;
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Persons Involved Table
  y = checkPageBreak(doc, y, 25, data.priority);
  const persons = data.linked_persons || [];
  { const sec = openAutoSection(doc, `Persons Involved (${persons.length})`, y); y = sec.contentY;
    if (persons.length > 0) {
      const colPositions = [lx, LAYOUT.PAGE_MARGIN + 30, LAYOUT.PAGE_MARGIN + 70, LAYOUT.PAGE_MARGIN + 110];
      const tableHeaders = [
        { label: 'ROLE', x: colPositions[0] },
        { label: 'LAST NAME', x: colPositions[1] },
        { label: 'FIRST NAME', x: colPositions[2] },
        { label: 'DOB', x: colPositions[3] },
      ];
      const tableRows = persons.map((p) => [
        p.role?.replace(/_/g, ' ') || '',
        p.last_name || '',
        p.first_name || '',
        p.dob || '',
      ]);
      y = addTableWithShading(doc, tableHeaders, tableRows, y, colPositions);
    } else {
      doc.setFontSize(FONT.SIZE_TABLE_BODY);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('None recorded', lx, y);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      y += SPACING.XL;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Vehicles Involved Table
  y = checkPageBreak(doc, y, 25, data.priority);
  const vehicles = data.linked_vehicles || [];
  { const sec = openAutoSection(doc, `Vehicles Involved (${vehicles.length})`, y); y = sec.contentY;
    if (vehicles.length > 0) {
      const colPositions = [lx, LAYOUT.PAGE_MARGIN + 30, LAYOUT.PAGE_MARGIN + 65, LAYOUT.PAGE_MARGIN + 120];
      const tableHeaders = [
        { label: 'ROLE', x: colPositions[0] },
        { label: 'PLATE', x: colPositions[1] },
        { label: 'YEAR/MAKE/MODEL', x: colPositions[2] },
        { label: 'COLOR', x: colPositions[3] },
      ];
      const tableRows = vehicles.map((v) => [
        v.role?.replace(/_/g, ' ') || '',
        `${v.plate_number || 'N/A'}${v.state ? ' (' + v.state + ')' : ''}`,
        [v.year, v.make, v.model].filter(Boolean).join(' '),
        v.color || '',
      ]);
      y = addTableWithShading(doc, tableHeaders, tableRows, y, colPositions);
    } else {
      doc.setFontSize(FONT.SIZE_TABLE_BODY);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('None recorded', lx, y);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      y += SPACING.XL;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Evidence Table
  y = checkPageBreak(doc, y, 25, data.priority);
  const evidence = data.evidence || [];
  { const sec = openAutoSection(doc, `Evidence (${evidence.length})`, y); y = sec.contentY;
    if (evidence.length > 0) {
      const colPositions = [lx, LAYOUT.PAGE_MARGIN + 25, LAYOUT.PAGE_MARGIN + 55, LAYOUT.PAGE_MARGIN + 130];
      const tableHeaders = [
        { label: 'ITEM #', x: colPositions[0] },
        { label: 'TYPE', x: colPositions[1] },
        { label: 'DESCRIPTION', x: colPositions[2] },
        { label: 'STORAGE', x: colPositions[3] },
      ];
      const tableRows = evidence.map((e) => [
        e.evidence_number || '',
        e.evidence_type || '',
        e.description || '',
        e.storage_location || '',
      ]);
      y = addTableWithShading(doc, tableHeaders, tableRows, y, colPositions);
    } else {
      doc.setFontSize(FONT.SIZE_TABLE_BODY);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('None recorded', lx, y);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      y += SPACING.XL;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // LE Coordination
  if (data.responding_le_agency || data.le_case_number) {
    y = checkPageBreak(doc, y, 20, data.priority);
    const sec = openAutoSection(doc, 'External Agency Coordination', y); y = sec.contentY;
    addFieldPair(doc, 'Responding Agency', data.responding_le_agency || '', lx, y, hfw);
    y = addFieldPair(doc, 'LE Case #', data.le_case_number || '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Narrative
  y = addNarrativeSection(doc, 'Narrative', data.narrative || '', y, data.priority);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  // Signatures
  y = checkPageBreak(doc, y, 40, data.priority);
  { const sec = openAutoSection(doc, 'Signatures', y); y = sec.contentY;
    addSignatureBlock(doc, 'Reporting Officer', lx, y, hfw, getOfficerSig());
    y = addSignatureBlock(doc, 'Supervisor Review', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }
}

function generateTrespassWarning(doc: jsPDF, data: IncidentData) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const hw = getHalfWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);


  let y = addReportHeader(doc, data.incident_number, 'Trespass Warning', data.priority, undefined, { useLogo: true });

  // Large WARNING banner
  const primaryRgb = hexToRgb(activeBranding.primary_color);
  doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.rect(LAYOUT.PAGE_MARGIN, y, cw, 12, 'F');
  doc.setDrawColor(...COLOR.TEXT_INVERTED);
  doc.setLineWidth(BORDER.CASE_BOX);
  doc.rect(LAYOUT.PAGE_MARGIN + 1.5, y + 1.5, cw - 3, 9);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_BANNER);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text('NOTICE OF TRESPASS WARNING', pageWidth / 2, y + 8.5, { align: 'center' });
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  y += 16;

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
      addFieldPair(doc, 'DOB', '', lx, y, hfw);
      y += SPACING.FIELD_ROW_ADVANCE;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Property Information
  { const sec = openAutoSection(doc, 'Property Information', y); y = sec.contentY;
    y = addFieldPair(doc, 'Location', data.location, lx, y, ffw);
    y = addFieldPair(doc, 'Property Boundaries', data.property_boundaries || '', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Warning Dates
  { const sec = openAutoSection(doc, 'Warning Period', y); y = sec.contentY;
    addFieldPair(doc, 'Effective Date', data.trespass_effective_date || '', lx, y, hfw);
    y = addFieldPair(doc, 'Expiry Date', data.trespass_expiry_date || '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Warning Text
  { const sec = openAutoSection(doc, 'Notice', y); y = sec.contentY;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_FIELD_VALUE);
    const warningText = 'You are hereby notified that you are PROHIBITED from entering, remaining upon, or returning to the above-described property. Any violation of this warning may result in your arrest for Criminal Trespass pursuant to applicable state law. This warning is effective for the period indicated above.';
    y = addWrappedText(doc, warningText, lx, y, ffw, 9);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Narrative
  y = addNarrativeSection(doc, 'Officer Notes', data.narrative || '', y, data.priority);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  // Signatures — 3 blocks
  y = checkPageBreak(doc, y, 80, data.priority);
  { const sec = openAutoSection(doc, 'Signatures', y); y = sec.contentY;
    y = addSignatureBlock(doc, 'Subject (Acknowledgment of Receipt)', lx, y, ffw);
    addSignatureBlock(doc, 'Issuing Officer', lx, y, hfw, getOfficerSig());
    y = addSignatureBlock(doc, 'Witness', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Distribution
  y += SPACING.LG;
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('DISTRIBUTION: ORIGINAL \u2014 FILE | COPY 1 \u2014 SUBJECT | COPY 2 \u2014 PROPERTY MANAGEMENT', lx, y);
}

function generateAccidentReport(doc: jsPDF, data: IncidentData) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);


  let y = addReportHeader(doc, data.incident_number, 'Vehicle Accident Report', data.priority, undefined, { useLogo: true });

  // Incident Info
  { const sec = openAutoSection(doc, 'Incident Information', y); y = sec.contentY;
    y = addFieldPair(doc, 'Location', data.location, lx, y, ffw);
    y = addThreeColumnFields(doc, [
      { label: 'Date', value: data.occurred_date || '' },
      { label: 'Time', value: data.occurred_time || '' },
      { label: 'Officer', value: data.officer_name },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Road Conditions
  { const sec = openAutoSection(doc, 'Conditions', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Road Conditions', value: data.road_conditions || '' },
      { label: 'Traffic Control', value: data.traffic_control || '' },
      { label: 'Weather', value: data.weather_conditions || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Vehicle 1
  { const sec = openAutoSection(doc, 'Vehicle #1', y); y = sec.contentY;
    y = addFieldPair(doc, 'Vehicle Description', data.vehicle_1_info || '', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Vehicle 2
  y = checkPageBreak(doc, y, 30, data.priority);
  { const sec = openAutoSection(doc, 'Vehicle #2', y); y = sec.contentY;
    y = addFieldPair(doc, 'Vehicle Description', data.vehicle_2_info || '', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y);
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
    doc.text('(DRAW DIAGRAM \u2014 INDICATE NORTH, VEHICLES, DIRECTION OF TRAVEL, POINT OF IMPACT)', pageWidth / 2, y + 60, { align: 'center' });
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.setDrawColor(...COLOR.TEXT_PRIMARY);
    y += 65;
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Scene Notes
  y = addNarrativeSection(doc, 'Scene Notes', data.diagram_notes || '', y, data.priority);

  // Injuries & Damage
  y = checkPageBreak(doc, y, 20, data.priority);
  { const sec = openAutoSection(doc, 'Injuries & Damage', y); y = sec.contentY;
    addFieldPair(doc, 'Injuries', `${data.injuries || 'None'}${data.injury_description ? ' \u2014 ' + data.injury_description : ''}`, lx, y, hfw);
    y = addFieldPair(doc, 'Damage Estimate', data.damage_estimate ? '$' + data.damage_estimate : '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Narrative
  y = addNarrativeSection(doc, 'Narrative', data.narrative || '', y, data.priority);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  // Signatures
  y = checkPageBreak(doc, y, 40, data.priority);
  { const sec = openAutoSection(doc, 'Signatures', y); y = sec.contentY;
    addSignatureBlock(doc, 'Investigating Officer', lx, y, hfw, getOfficerSig());
    y = addSignatureBlock(doc, 'Supervisor Review', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }
}

function generateMedicalReport(doc: jsPDF, data: IncidentData) {
  const cw = getContentWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);


  let y = addReportHeader(doc, data.incident_number, 'Medical Response Report', data.priority, undefined, { useLogo: true });

  // Incident Info
  { const sec = openAutoSection(doc, 'Incident Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Type', value: formatIncidentType(data.incident_type) },
      { label: 'Priority', value: data.priority },
      { label: 'Officer', value: data.officer_name },
    ], y);
    y = addFieldPair(doc, 'Location', data.location, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y);
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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Vitals
  y = addNarrativeSection(doc, 'Vitals / Condition', data.patient_vitals || '', y, data.priority);

  // Treatment
  y = addNarrativeSection(doc, 'Treatment Rendered', data.treatment_rendered || '', y, data.priority);

  // Narrative
  y = addNarrativeSection(doc, 'Narrative', data.narrative || '', y, data.priority);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  // Signatures
  y = checkPageBreak(doc, y, 75, data.priority);
  { const sec = openAutoSection(doc, 'Signatures', y); y = sec.contentY;
    addSignatureBlock(doc, 'Responding Officer', lx, y, hfw, getOfficerSig());
    y = addSignatureBlock(doc, 'Supervisor Review', rx, y, hfw);
    y = addSignatureBlock(doc, 'Patient Refusal (if applicable)', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }
}

function generateUseOfForceReport(doc: jsPDF, data: IncidentData) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);


  let y = addReportHeader(doc, data.incident_number, 'Use of Force Report', data.priority, undefined, { useLogo: true });

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
  doc.text('MANDATORY REPORT \u2014 MUST BE COMPLETED WITHIN 24 HOURS OF INCIDENT', pageWidth / 2, y + 5.5, { align: 'center' });
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
    y = closeAutoSection(doc, sec.sectionY, y);
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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // De-Escalation
  y = addNarrativeSection(doc, 'De-Escalation Attempts', data.de_escalation_attempts || '', y, data.priority);

  // Justification
  y = addNarrativeSection(doc, 'Justification', data.force_justification || '', y, data.priority);

  // Injuries
  y = checkPageBreak(doc, y, 20, data.priority);
  { const sec = openAutoSection(doc, 'Injuries', y); y = sec.contentY;
    addFieldPair(doc, 'Subject Injuries', data.subject_injuries || 'None', lx, y, hfw);
    y = addFieldPair(doc, 'Officer Injuries', data.officer_injuries || 'None', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Narrative
  y = addNarrativeSection(doc, 'Narrative', data.narrative || '', y, data.priority);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  // Signatures
  y = checkPageBreak(doc, y, 40, data.priority);
  { const sec = openAutoSection(doc, 'Signatures', y); y = sec.contentY;
    addSignatureBlock(doc, 'Reporting Officer', lx, y, hfw, getOfficerSig());
    y = addSignatureBlock(doc, 'Supervisor Review', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }
}

function generateDailyActivityReport(doc: jsPDF, data: IncidentData) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);


  let y = addReportHeader(doc, data.incident_number, 'Daily Activity Report', data.priority, undefined, { useLogo: true });

  // Officer / Shift Info
  { const sec = openAutoSection(doc, 'Officer / Shift Information', y); y = sec.contentY;
    addFieldPair(doc, 'Officer', data.officer_name, lx, y, hfw);
    y = addFieldPair(doc, 'Sec/Zone/Beat', [data.section_id, data.zone_id, data.beat_id].filter(Boolean).join(' / ') || '', rx, y, hfw);
    addFieldPair(doc, 'Shift Date', data.occurred_date || '', lx, y, hfw);
    y = addFieldPair(doc, 'Shift Time', `${data.occurred_time || ''} \u2014 ${data.end_time || ''}`, rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Activity Log
  { const sec = openAutoSection(doc, 'Activity Log', y); y = sec.contentY;
    // Light table header row with dark text
    doc.setFillColor(...COLOR.BG_TABLE_HDR);
    doc.rect(LAYOUT.PAGE_MARGIN + 1, y - 2, cw - 2, 7, 'F');
    doc.setDrawColor(...COLOR.BORDER_TABLE);
    doc.setLineWidth(BORDER.TABLE_ROW * 3);
    doc.line(LAYOUT.PAGE_MARGIN + 1, y + 5, LAYOUT.PAGE_MARGIN + cw - 1, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_TABLE_HEADER);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Narrative summary
  y = addNarrativeSection(doc, 'Summary / Notes', data.narrative || '', y, data.priority);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  // Signature
  y = checkPageBreak(doc, y, 40, data.priority);
  { const sec = openAutoSection(doc, 'Signatures', y); y = sec.contentY;
    addSignatureBlock(doc, 'Officer', lx, y, hfw, getOfficerSig());
    y = addSignatureBlock(doc, 'Supervisor Review', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }
}

function generateArrestReport(doc: jsPDF, data: IncidentData) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);


  let y = addReportHeader(doc, data.incident_number, 'Arrest / Detention Report', data.priority, undefined, { useLogo: true });

  // Incident Info
  { const sec = openAutoSection(doc, 'Incident Information', y); y = sec.contentY;
    y = addFieldPair(doc, 'Location', data.location, lx, y, ffw);
    addFieldPair(doc, 'Date', data.occurred_date || '', lx, y, hfw);
    y = addFieldPair(doc, 'Time', data.occurred_time || '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Subject Details
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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Flags
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
    y = closeAutoSection(doc, sec.sectionY, y);
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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Miranda Advisement
  y = checkPageBreak(doc, y, 30, data.priority);
  { const sec = openAutoSection(doc, 'Miranda Advisement', y); y = sec.contentY;
    doc.setFontSize(FONT.SIZE_TABLE_BODY);
    doc.setFont('helvetica', 'normal');
    doc.text('You have the right to remain silent. Anything you say can and will be used against you in a court of law.', lx, y);
    y += 4;
    doc.text('You have the right to an attorney. If you cannot afford an attorney, one will be appointed for you.', lx, y);
    y += SPACING.XL;
    addFieldPair(doc, 'Miranda Given At', '', lx, y, hfw);
    y = addFieldPair(doc, 'Waived / Invoked', '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Narrative
  y = addNarrativeSection(doc, 'Narrative', data.narrative || '', y, data.priority);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / EVIDENCE PHOTOS', data.priority);
  }

  // Signatures
  y = checkPageBreak(doc, y, 40, data.priority);
  { const sec = openAutoSection(doc, 'Signatures', y); y = sec.contentY;
    addSignatureBlock(doc, 'Arresting Officer', lx, y, hfw, getOfficerSig());
    y = addSignatureBlock(doc, 'Transport Officer', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }
}

// ── Process Service Report ────────────────────────────────────

function generateProcessServiceReport(doc: jsPDF, data: IncidentData) {
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);

  const serviceTypeLabel = (data.process_service_type || '').replace(/_/g, ' ').toUpperCase() || 'GENERAL';

  let y = addReportHeader(doc, data.incident_number, 'Process Service Report', data.priority, undefined, { useLogo: true });

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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Client / Requestor Information
  y = checkPageBreak(doc, y, 30, data.priority);
  { const sec = openAutoSection(doc, 'Client / Requestor Information', y); y = sec.contentY;
    addFieldPair(doc, 'Requestor Name', data.pso_requestor_name || '', lx, y, hfw);
    y = addFieldPair(doc, 'Requestor Phone', data.pso_requestor_phone || '', rx, y, hfw);
    addFieldPair(doc, 'Requestor Email', data.pso_requestor_email || '', lx, y, hfw);
    y = addFieldPair(doc, 'Billing Code', data.pso_billing_code || '', rx, y, hfw);
    addFieldPair(doc, 'Authorization / PO#', data.pso_authorization || '', lx, y, hfw);
    y = addFieldPair(doc, 'PSO Service Type', (data.pso_service_type || '').replace(/_/g, ' ').toUpperCase(), rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Service of Process Details
  y = checkPageBreak(doc, y, 35, data.priority);
  { const sec = openAutoSection(doc, 'Service of Process Details', y); y = sec.contentY;
    addFieldPair(doc, 'Document Type', serviceTypeLabel, lx, y, hfw);
    y = addFieldPair(doc, 'Serve To (Name)', data.process_served_to || '', rx, y, hfw);
    y = addFieldPair(doc, 'Service Address', data.process_served_address || data.location || '', lx, y, ffw);
    addFieldPair(doc, 'Attempts Made', String(data.process_attempts || 0), lx, y, hfw);
    y = addFieldPair(doc, 'Served At', data.process_served_at || '', rx, y, hfw);
    y = addFieldPair(doc, 'Service Result', (data.process_service_result || '').replace(/_/g, ' ').toUpperCase(), lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Officer / Location
  y = checkPageBreak(doc, y, 25, data.priority);
  { const sec = openAutoSection(doc, 'Officer / Location', y); y = sec.contentY;
    addFieldPair(doc, 'Officer', data.officer_name, lx, y, hfw);
    y = addFieldPair(doc, 'Location', data.location, rx, y, hfw);
    if (data.section_id || data.zone_id || data.beat_id) {
      y = addThreeColumnFields(doc, [
        { label: 'Section ID', value: data.section_id || '' },
        { label: 'Zone ID', value: data.zone_id || '' },
        { label: 'Beat ID', value: data.beat_id || '' },
      ], y);
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Date / Time
  y = checkPageBreak(doc, y, 20, data.priority);
  { const sec = openAutoSection(doc, 'Date / Time', y); y = sec.contentY;
    addFieldPair(doc, 'Occurred Date', data.occurred_date || '', lx, y, hfw);
    y = addFieldPair(doc, 'Occurred Time', data.occurred_time || '', rx, y, hfw);
    addFieldPair(doc, 'End Date', data.end_date || '', lx, y, hfw);
    y = addFieldPair(doc, 'End Time', data.end_time || '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Flags
  y = checkPageBreak(doc, y, 20, data.priority);
  { const sec = openAutoSection(doc, 'Flags', y); y = sec.contentY;
    let flagX = lx;
    flagX = addCheckboxField(doc, 'Evidence', !!data.evidence_collected, flagX, y);
    flagX = addCheckboxField(doc, 'BWC Active', !!data.body_camera_active, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'Photos', !!data.photos_taken, flagX + SPACING.SM, y);
    flagX = addCheckboxField(doc, 'LE Notified', !!data.le_notified, flagX + SPACING.SM, y);
    addCheckboxField(doc, 'Supvr Notified', !!data.supervisor_notified, flagX + SPACING.SM, y);
    y += SPACING.XL;
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Narrative
  y = addNarrativeSection(doc, 'Narrative / Service Notes', data.narrative || '', y, data.priority);

  // Linked Persons (subjects being served)
  if (data.linked_persons && data.linked_persons.length > 0) {
    y = checkPageBreak(doc, y, 25, data.priority);
    const sec = openAutoSection(doc, 'Linked Persons', y); y = sec.contentY;
    const colPositions = [lx, LAYOUT.PAGE_MARGIN + 50, LAYOUT.PAGE_MARGIN + 100, LAYOUT.PAGE_MARGIN + 135];
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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'ATTACHMENTS / SERVICE DOCUMENTS', data.priority);
  }

  // Signatures
  y = checkPageBreak(doc, y, 40, data.priority);
  { const sec = openAutoSection(doc, 'Signatures', y); y = sec.contentY;
    addSignatureBlock(doc, 'Process Server / Officer', lx, y, hfw, getOfficerSig());
    y = addSignatureBlock(doc, 'Supervisor', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }
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
  const filename = `${data.incident_number}_${reportType}.pdf`;
  doc.save(filename);
}

/** Generate incident report PDF and return a blob URL for in-app preview */
export async function generatePdfReportBlobUrl(reportType: PdfReportType, data: IncidentData): Promise<string> {
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
}
