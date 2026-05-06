import jsPDF from 'jspdf';
import { LayoutEngine } from './layout';
import { Primitives, ROW_HEIGHT } from './primitives';
import { drawDefaultHeader } from './header';
import { drawDefaultFooter } from './footer';
import { makeRenderContext, drawSectionHeader, closeSection } from './context';
import { drawBlankFormWatermark, drawDraftWatermark } from './watermark';
import type {
  FormSchema, SchemaSection, RenderCallback, FieldSpec, LabeledField,
} from './types';

function drawWatermarkIfAny(doc: jsPDF, mode: string | undefined): void {
  if (mode === 'blank-form') drawBlankFormWatermark(doc);
  else if (mode === 'draft') drawDraftWatermark(doc);
}

export interface RenderOptions {
  /**
   * Timestamp used for the footer's "Generated YYYY-MM-DD" text. Defaults to
   * `new Date()`. Tests pin this so snapshot byte output is stable.
   */
  generatedAt?: Date;
}

export async function renderPdfV2<T>(
  schema: FormSchema<T>,
  data: T,
  options?: RenderOptions,
): Promise<jsPDF> {
  // mm units so v1 helpers (drawNibrsHeader, etc.) render at their designed scale.
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });

  // Watermark is drawn BEFORE the header so header text sits on top of it.
  if (schema.watermark) drawWatermarkIfAny(doc, schema.watermark);

  const headerBottomY = drawDefaultHeader(doc, schema.meta, {
    caseNumber: schema.header.caseNumberAccessor?.(data),
  });

  const layout = new LayoutEngine(doc, {
    topMargin: headerBottomY + 1,
    bottomMargin: 18,
    leftMargin: 10,
    rightMargin: 10,
  });
  const prims = new Primitives(doc, layout);

  for (const section of schema.sections) {
    if (isCallback<T>(section)) {
      const ctx = makeRenderContext(doc, layout, prims, data);
      section(ctx, data);
    } else {
      const schemaSec = section as SchemaSection<T>;
      if (schemaSec.visibleIf && !schemaSec.visibleIf(data)) continue;
      drawSectionHeader(doc, layout, schemaSec.title);
      renderSectionFields(prims, layout, schemaSec, data);
      closeSection(layout);
    }
  }

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    // Re-stamp the watermark on every page so multi-page output is consistent.
    if (schema.watermark && p > 1) drawWatermarkIfAny(doc, schema.watermark);
    drawDefaultFooter(doc, {
      pageNumber: p,
      totalPages: total,
      revision: schema.meta.revision,
      formNumber: schema.meta.formNumber,
      generatedAt: options?.generatedAt,
    });
  }

  return doc;
}

function renderSectionFields<T>(
  prims: Primitives, layout: LayoutEngine, section: SchemaSection<T>, data: T,
): void {
  const cols = section.columns ?? 1;
  if (cols === 1) {
    for (const f of section.fields) renderField(prims, f, data);
    return;
  }

  // Multi-column: group labeled fields into rows of `cols` that render on a
  // single line; fall back to full-width for non-labeled fields.
  const buffer: LabeledField<T>[] = [];
  const flushBuffer = () => {
    if (buffer.length === 0) return;
    renderLabeledRow(prims, layout, buffer, data, cols);
    buffer.length = 0;
  };

  for (const field of section.fields) {
    if (field.kind === 'labeled') {
      buffer.push(field);
      if (buffer.length === cols) flushBuffer();
    } else {
      flushBuffer();
      renderField(prims, field, data);
    }
  }
  flushBuffer();
}

function renderLabeledRow<T>(
  prims: Primitives, layout: LayoutEngine, fields: LabeledField<T>[], data: T, cols: number,
): void {
  layout.pageBreakIfNeeded(ROW_HEIGHT);
  const totalW = layout.rightX - layout.leftX;
  const colW = totalW / cols;
  const startY = layout.cursorY;
  fields.forEach((f, i) => {
    layout.setCursor(startY);
    prims.labeledField(f, data, layout.leftX + i * colW, colW - 2);
  });
  layout.setCursor(startY);
  layout.advance(ROW_HEIGHT);
}

function isCallback<T>(s: unknown): s is RenderCallback<T> {
  return typeof s === 'function';
}

function renderField<T>(prims: Primitives, field: FieldSpec<T>, data: T): void {
  switch (field.kind) {
    case 'labeled':   prims.labeledField(field, data); return;
    case 'checkbox':  prims.checkboxRow([field], data); return;
    case 'narrative': prims.narrative(field, data); return;
    case 'table':     prims.table(field, data); return;
    case 'signature': prims.signature(field, data); return;
    case 'spacer':    prims.spacer(field.height); return;
  }
}
