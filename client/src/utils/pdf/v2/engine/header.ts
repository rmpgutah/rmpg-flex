import jsPDF from 'jspdf';
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING, AGENCY } from './style';
import type { FormMeta } from './types';

export interface HeaderContext {
  caseNumber?: string;
  pageNumber?: number;
  totalPages?: number;
}

const PAGE_WIDTH = 215.9;  // letter, mm
const TOP = 8;             // mm from page top to first rule

/**
 * Spillman/Motorola-style page header.
 *
 * Layout (top → bottom):
 *   ── thick rule (RULE_WEIGHTS.headerThick) ───────
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

  // 1) Thick top rule
  doc.setLineWidth(RULE_WEIGHTS.headerThick);
  doc.line(left, TOP, right, TOP);

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
  if (ctx.caseNumber) parts.push(`CASE ${ctx.caseNumber}`);
  if (ctx.pageNumber && ctx.totalPages) parts.push(`PAGE ${ctx.pageNumber} OF ${ctx.totalPages}`);
  doc.text(parts.join('  ·  '), right, y, { align: 'right' });

  // 6) Thin bottom rule
  y += 2;
  doc.setLineWidth(RULE_WEIGHTS.headerThin);
  doc.line(left, y, right, y);

  return y;
}
