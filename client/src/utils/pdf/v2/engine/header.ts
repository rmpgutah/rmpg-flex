import jsPDF from 'jspdf';
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING, AGENCY, TONES_RGB } from './style';
import type { FormMeta } from './types';

export interface HeaderContext {
  caseNumber?: string;
  /** Label for the caseNumber value (default 'CASE') — see HeaderSpec.caseLabel. */
  caseLabel?: string;
  pageNumber?: number;
  totalPages?: number;
  /** Dark-colored emblem (RMPG Logo Dark, composited onto white) — the
   *  header renders on white paper, so only the dark variant applies here.
   *  A light/white emblem variant exists in pdfAssets.ts for future
   *  dark-filled surfaces, but has no header placement. */
  logoBase64?: string;
}

const PAGE_WIDTH = 215.9;  // letter, mm
const TOP = 8;             // mm from page top to first rule

/**
 * Spillman/Motorola-style page header — LOW INK DESIGN.
 *
 * Layout (top → bottom):
 *   ── thin rule (RULE_WEIGHTS.headerThick) ───────  (reduced from thick)
 *           ROCKY MOUNTAIN PROTECTIVE GROUP        (11pt bold, centered)
 *               SALT LAKE CITY, UTAH               (8pt regular, centered)
 *                    CITATION                       (14pt bold UPPERCASE, centered)
 *   FORM PS-209  ·  CASE 26-CFS00242  ·  PAGE 1 OF 4  (7pt regular, right-aligned)
 *   ── thin rule (RULE_WEIGHTS.headerThin) ─────────
 *
 * Returns the Y position (mm from page top) where the next content
 * block should start.
 */
export function drawDefaultHeader(
  doc: jsPDF,
  meta: FormMeta,
  ctx: HeaderContext = {},
): number {
  const left = SPACING.pageMarginLeft;
  const right = PAGE_WIDTH - SPACING.pageMarginRight;
  const center = PAGE_WIDTH / 2;

  // 1) Top rule — steel-blue accent (2026-07: restrained color upgrade,
  // replaces the black rule; still renders as a distinguishable mid-gray
  // on B&W laser printers).
  doc.setDrawColor(...TONES_RGB.accentSteel);
  doc.setLineWidth(RULE_WEIGHTS.headerThick);
  doc.line(left, TOP, right, TOP);
  doc.setDrawColor(0, 0, 0); // reset for the bottom rule + everything downstream

  // 1b) Emblem — dark-colored logo, top-left of the header block (white
  // paper background). Rendered as a horizontal banner logo at 40×13mm
  // (approx 3:1 aspect for the horizontal RMPG logo variants).
  // Falls back to 13×13mm square for non-horizontal/square logos.
  if (ctx.logoBase64) {
    const logoW = 40;
    const logoH = 13;
    try {
      doc.addImage(ctx.logoBase64, 'PNG', left, TOP + 0.5, logoW, logoH);
    } catch {
      /* ignore malformed image, header renders without it */
    }
  }

  // 2) Agency name
  doc.setFont('helvetica', TYPOGRAPHY.agencyName.weight);
  doc.setFontSize(TYPOGRAPHY.agencyName.size);
  let y = TOP + 5.5;
  doc.text(AGENCY.name, center, y, { align: 'center' });

  // 3) City/state subline
  doc.setFont('helvetica', TYPOGRAPHY.agencySubline.weight);
  doc.setFontSize(TYPOGRAPHY.agencySubline.size);
  y += 4;
  doc.text(AGENCY.location, center, y, { align: 'center' });

  // 4) Form title (UPPERCASE)
  doc.setFont('helvetica', TYPOGRAPHY.formTitle.weight);
  doc.setFontSize(TYPOGRAPHY.formTitle.size);
  y += 7;
  doc.text(meta.title.toUpperCase(), center, y, { align: 'center' });

  // 5) Form-meta row (right-aligned): FORM · CASE · PAGE
  y += 5;
  doc.setFont('helvetica', TYPOGRAPHY.formMeta.weight);
  doc.setFontSize(TYPOGRAPHY.formMeta.size);
  const parts = [`FORM ${meta.formNumber}`];
  if (ctx.caseNumber) parts.push(`${ctx.caseLabel || 'CASE'} ${ctx.caseNumber}`);
  // Page X of Y always shown in header for multi-page awareness
  if (ctx.pageNumber && ctx.totalPages) parts.push(`PAGE ${ctx.pageNumber} OF ${ctx.totalPages}`);
  doc.text(parts.join('  ·  '), right, y, { align: 'right' });

  // 6) Thin bottom rule
  y += 2;
  doc.setLineWidth(RULE_WEIGHTS.headerThin);
  doc.line(left, y, right, y);

  return y;
}
