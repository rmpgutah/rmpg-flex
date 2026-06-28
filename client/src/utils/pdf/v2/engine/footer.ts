import type jsPDF from 'jspdf';
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING, FOOTER_TEXT } from './style';

export interface FooterOptions {
  pageNumber: number;
  totalPages: number;
  revision: string;
  formNumber?: string;
  /**
   * Optional generation timestamp; reserved for future use. Kept on the
   * options shape so renderer.ts callers don't need to change shape when
   * we re-introduce a generated-date glyph.
   */
  generatedAt?: Date;
}

/**
 * Spillman/Motorola-style page footer.
 *
 * Layout (mm units):
 *   ── thin rule (RULE_WEIGHTS.footerRule) ──────────────────────
 *   PROPERTY OF ROCKY MOUNTAIN PROTECTIVE GROUP …    PAGE N OF M
 *   REV. <revision>                                  FORM <formNumber>
 */
export function drawDefaultFooter(doc: jsPDF, opts: FooterOptions): void {
  const pageWidth  = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left  = SPACING.pageMarginLeft;
  const right = pageWidth - SPACING.pageMarginRight;
  const ruleY = pageHeight - SPACING.pageMarginBottom + 2;

  // @ts-expect-error jsPDF GState — keep footer fully opaque even after watermark
  doc.setGState(new doc.GState({ opacity: 1.0 }));
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(RULE_WEIGHTS.footerRule);
  doc.line(left, ruleY, right, ruleY);

  doc.setTextColor(0, 0, 0);

  // Line 1: classification (left) + page number (right, bold).
  let y = ruleY + 3.5;
  doc.setFont('helvetica', TYPOGRAPHY.footerText.weight);
  doc.setFontSize(TYPOGRAPHY.footerText.size);
  doc.text(FOOTER_TEXT.classification, left, y);

  doc.setFont('helvetica', TYPOGRAPHY.pageNumber.weight);
  doc.setFontSize(TYPOGRAPHY.pageNumber.size);
  doc.text(`PAGE ${opts.pageNumber} OF ${opts.totalPages}`, right, y, { align: 'right' });

  // Line 2: form revision (left) + form number (right, when provided).
  y += 3.5;
  doc.setFont('helvetica', TYPOGRAPHY.footerText.weight);
  doc.setFontSize(TYPOGRAPHY.footerText.size);
  doc.text(`REV. ${opts.revision}`, left, y);
  if (opts.formNumber) {
    doc.text(`FORM ${opts.formNumber}`, right, y, { align: 'right' });
  }
}
