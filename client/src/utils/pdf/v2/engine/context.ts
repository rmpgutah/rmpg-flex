import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import type { Primitives } from './primitives';
import type {
  RenderContext, LabeledField, CheckboxField, NarrativeField, TableField, SignatureField,
} from './types';

export function drawSectionHeader(doc: jsPDF, layout: LayoutEngine, title: string): void {
  const headerHeight = 16;
  layout.pageBreakIfNeeded(headerHeight + 4);
  const y = layout.cursorY;
  doc.setFillColor(26, 38, 54);
  doc.rect(layout.leftX, y, layout.rightX - layout.leftX, headerHeight, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(212, 160, 23);
  doc.text(title, layout.leftX + 6, y + 11);
  doc.setTextColor(0, 0, 0);
  layout.advance(headerHeight + 6);
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
