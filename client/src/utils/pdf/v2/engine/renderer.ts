import jsPDF from 'jspdf';
import { LayoutEngine } from './layout';
import { Primitives } from './primitives';
import { drawDefaultHeader } from './header';
import { drawDefaultFooter } from './footer';
import { makeRenderContext, drawSectionHeader } from './context';
import type { FormSchema, SchemaSection, RenderCallback, FieldSpec } from './types';

export async function renderPdfV2<T>(schema: FormSchema<T>, data: T): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const headerBottomY = drawDefaultHeader(doc, schema.meta, {
    caseNumber: schema.header.caseNumberAccessor?.(data),
  });

  const layout = new LayoutEngine(doc, {
    topMargin: headerBottomY + 4, bottomMargin: 50, leftMargin: 40, rightMargin: 40,
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
      for (const field of schemaSec.fields) {
        renderField(prims, field, data);
      }
      prims.spacer(8);
    }
  }

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawDefaultFooter(doc, { pageNumber: p, totalPages: total, revision: schema.meta.revision });
  }

  return doc;
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
