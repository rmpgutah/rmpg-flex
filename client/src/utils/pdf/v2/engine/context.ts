import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import type { Primitives } from './primitives';
import type {
  RenderContext, LabeledField, CheckboxField, NarrativeField, TableField, SignatureField,
} from './types';
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING } from './style';

const SECTION_GAP = SPACING.sectionGap;

/**
 * Spillman/Motorola-style section header: plain bold UPPERCASE text at left,
 * a thin rule across the full content width directly below. No fill bar.
 * Doc must be in mm units.
 */
export function drawSectionHeader(doc: jsPDF, layout: LayoutEngine, title: string): void {
  layout.pageBreakIfNeeded(8);
  const y = layout.cursorY;

  // Ensure full opacity (safety reset after watermark GState)
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  doc.setFont('helvetica', TYPOGRAPHY.sectionHeader.weight);
  doc.setFontSize(TYPOGRAPHY.sectionHeader.size);
  doc.setTextColor(0, 0, 0);
  doc.text(title.toUpperCase(), layout.leftX, y);

  // Thin rule across the full content width, just below the text baseline
  const ruleY = y + 1.5;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(RULE_WEIGHTS.sectionRule);
  doc.line(layout.leftX, ruleY, layout.rightX, ruleY);

  layout.advance(SPACING.sectionGap + 4); // baseline + rule + gap
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
