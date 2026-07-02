import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import type { Primitives } from './primitives';
import type {
  RenderContext, LabeledField, CheckboxField, NarrativeField, TableField, SignatureField,
} from './types';
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING, TONES_RGB } from './style';

const SECTION_GAP = SPACING.sectionGap;

// Section counter for numbered section headers (Police Report Format).
// Reset per document via resetSectionCounter().
let _sectionCounter = 0;

/** Reset the section counter at the start of each document render. */
export function resetSectionCounter(): void {
  _sectionCounter = 0;
}

/**
 * Spillman/Motorola-style section header — POLICE REPORT FORMAT.
 * Renders numbered section titles: "1. CLASSIFICATION", "2. DATE & TIME", etc.
 * The number prefix aids cross-referencing in court filings and
 * chain-of-custody documentation.
 *
 * Doc must be in mm units.
 */
export function drawSectionHeader(doc: jsPDF, layout: LayoutEngine, title: string): void {
  layout.pageBreakIfNeeded(8);
  const y = layout.cursorY;

  // Ensure full opacity (safety reset after watermark GState)
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  // Left accent bar (gold brand color) — 0.5mm wide × 3mm tall
  doc.setFillColor(212, 160, 23); // brand gold #d4a017
  doc.rect(layout.leftX - 1.5, y - 2.5, 0.5, 3, 'F');

  // Section number prefix (Police Report Format standard)
  _sectionCounter++;
  const numStr = `${_sectionCounter}.`;

  // Draw section number in bold
  doc.setFont('helvetica', TYPOGRAPHY.sectionNumber.weight);
  doc.setFontSize(TYPOGRAPHY.sectionNumber.size);
  doc.setTextColor(0, 0, 0);
  doc.text(numStr, layout.leftX, y);

  // Measure number width and draw title after it
  const numWidth = doc.getTextWidth(numStr);
  doc.setFont('helvetica', TYPOGRAPHY.sectionHeader.weight);
  doc.setFontSize(TYPOGRAPHY.sectionHeader.size);
  doc.text(title.toUpperCase(), layout.leftX + numWidth + 2, y);

  // Draw a thin rule under the section header (low ink: outline-only, no fill
  // bar). Steel-blue accent (2026-07) — distinct from the gold marker bar above.
  layout.advance(3);
  doc.setDrawColor(...TONES_RGB.accentSteel);
  doc.setLineWidth(RULE_WEIGHTS.sectionRule);
  doc.line(layout.leftX, layout.cursorY, layout.rightX, layout.cursorY);
  doc.setDrawColor(0, 0, 0); // reset for downstream drawing
  layout.advance(2);
}

/** Called by renderer after a section's fields have been drawn. */
export function closeSection(layout: LayoutEngine): void {
  layout.advance(SECTION_GAP);
}

export function makeRenderContext<T>(
  doc: jsPDF, layout: LayoutEngine, prims: Primitives, data: T,
): RenderContext<T> {
  return {
    get cursorY() { return layout.cursorY; },
    get pageHeight() { return layout.pageHeight; },
    get leftX() { return layout.leftX; },
    get rightX() { return layout.rightX; },
    columnWidth: (cols, _col) => (layout.rightX - layout.leftX) / cols,

    section(title, fn) {
      drawSectionHeader(doc, layout, title);
      fn(makeRenderContext(doc, layout, prims, data));
      closeSection(layout);
    },
    labeledField: (spec: LabeledField<T>) => prims.labeledField(spec, data),
    checkboxRow:  (specs: CheckboxField<T>[]) => prims.checkboxRow(specs, data),
    narrative:    (spec: NarrativeField<T>) => prims.narrative(spec, data),
    table:        (spec: TableField<T>) => prims.table(spec, data),
    signature:    (spec: SignatureField<T>) => prims.signature(spec, data),
    spacer:       (h) => prims.spacer(h),
    pageBreakIfNeeded: (h) => layout.pageBreakIfNeeded(h),
    get primitives() { return prims; },
    get layout() { return layout; },
  };
}
