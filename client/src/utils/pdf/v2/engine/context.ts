import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import type { Primitives } from './primitives';
import type {
  RenderContext, LabeledField, CheckboxField, NarrativeField, TableField, SignatureField,
} from './types';

const SECTION_HEADER_H = 5;      // mm — matches v1 SPACING.SECTION_HEADER_H
const SECTION_CONTENT_PAD = 3;   // mm — space above first row in a section
const SECTION_GAP = 3;           // mm — gap below each section

/**
 * Draw a NIBRS-style section header bar (dark fill, white text),
 * matching v1's `openAutoSection` chrome. Doc must be in mm units.
 */
export function drawSectionHeader(doc: jsPDF, layout: LayoutEngine, title: string): void {
  layout.pageBreakIfNeeded(SECTION_HEADER_H + SECTION_CONTENT_PAD + 4);
  const y = layout.cursorY;
  const width = layout.rightX - layout.leftX;

  // Ensure full opacity (safety reset after watermark GState)
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  // Dark section header bar (slate) matching v1 COLOR.BG_SECTION_HDR
  doc.setFillColor(45, 55, 72);
  doc.rect(layout.leftX, y, width, SECTION_HEADER_H, 'F');
  // Thin border
  doc.setDrawColor(180, 180, 185);
  doc.setLineWidth(0.1);
  doc.rect(layout.leftX, y, width, SECTION_HEADER_H);

  // White bold title, vertically centered in the bar
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  const capH = 8 * 0.35;
  const textY = y + (SECTION_HEADER_H + capH) / 2;
  doc.text(title.toUpperCase(), layout.leftX + 1.5, textY);

  // Reset text color to primary (black) — prevents white text leaking into content
  doc.setTextColor(0, 0, 0);
  layout.advance(SECTION_HEADER_H + SECTION_CONTENT_PAD);
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
  };
}
