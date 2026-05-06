import jsPDF from 'jspdf';
import { Panel } from './panel';
import { Primitives } from './primitives';
import { drawDefaultHeader } from './header';
import { drawDefaultFooter } from './footer';
import { makeRenderContext, drawSectionHeader, closeSection } from './context';
import { renderSectionFields } from './renderer';
import type { RenderOptions } from './renderer';
import type { FormSchema, SchemaSection, RenderCallback } from './types';
import type { CitationCopyVariant } from '../forms/citationInstructions';
import { TYPOGRAPHY, RULE_WEIGHTS } from './style';

const OUTER_MARGIN = 10;
const HEADER_GAP = 1;
const FOOTER_TOP = 18; // bottomMargin in existing renderer
const HALF_GAP = 5;

/**
 * Render a multi-copy PDF: each page is split vertically into a
 * left-half Panel that renders the form schema and a right-half
 * Panel that renders a copy-specific instruction block. Used for
 * the 3-copy hotdog-fold citation print: one shared citation
 * data block on the left, three different instruction blocks on
 * the right (Violator / Officer / Administrative).
 *
 * Footers are stamped after all content pages exist so PAGE N OF M
 * reflects total page count (continuation pages from long content
 * push the total beyond `copies.length`).
 */
export async function renderMultiCopyPdfV2<T>(
  schema: FormSchema<T>,
  data: T,
  copies: CitationCopyVariant[],
  options?: RenderOptions,
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });

  copies.forEach((copy, i) => {
    if (i > 0) doc.addPage();
    const copyStartPage = doc.getNumberOfPages();
    const headerBottomY = drawDefaultHeader(doc, schema.meta, {
      caseNumber: schema.header.caseNumberAccessor?.(data),
    });
    drawFoldRule(doc, headerBottomY);

    // Render right panel FIRST so its banner+body land on the copy-start page
    // before any left-panel overflow can advance jsPDF's current page.
    renderRightPanel(doc, copy, headerBottomY);

    // Snap back to the copy-start page (right panel may have advanced if its
    // own content overflowed — currently it doesn't, but be defensive).
    doc.setPage(copyStartPage);

    renderLeftPanel(doc, schema, data, headerBottomY);
  });

  // Footers go AFTER all content so PAGE N OF M reflects continuation pages.
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
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

function drawFoldRule(doc: jsPDF, headerBottomY: number): void {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const foldX = pageW / 2;
  doc.saveGraphicsState();
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(RULE_WEIGHTS.fieldUnderline);
  doc.line(foldX, headerBottomY + 1, foldX, pageH - FOOTER_TOP - 1);
  doc.restoreGraphicsState();
}

function renderLeftPanel<T>(
  doc: jsPDF, schema: FormSchema<T>, data: T, headerBottomY: number,
): void {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const foldX = pageW / 2;
  const panel = new Panel({
    left: OUTER_MARGIN,
    top: headerBottomY + HEADER_GAP,
    width: foldX - HALF_GAP - OUTER_MARGIN,
    height: pageH - FOOTER_TOP - (headerBottomY + HEADER_GAP),
  }, doc);
  const layout = panel.layout();
  const prims = new Primitives(doc, layout);

  for (const section of schema.sections) {
    if (typeof section === 'function') {
      const ctx = makeRenderContext(doc, layout, prims, data);
      (section as RenderCallback<T>)(ctx, data);
    } else {
      const s = section as SchemaSection<T>;
      if (s.visibleIf && !s.visibleIf(data)) continue;
      drawSectionHeader(doc, layout, s.title);
      renderSectionFields(prims, layout, s, data);
      closeSection(layout);
    }
  }
}

function renderRightPanel(doc: jsPDF, copy: CitationCopyVariant, headerBottomY: number): void {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const foldX = pageW / 2;
  const panel = new Panel({
    left: foldX + HALF_GAP,
    top: headerBottomY + HEADER_GAP,
    width: pageW - OUTER_MARGIN - (foldX + HALF_GAP),
    height: pageH - FOOTER_TOP - (headerBottomY + HEADER_GAP),
  }, doc);
  const layout = panel.layout();

  doc.saveGraphicsState();
  doc.setTextColor(0, 0, 0);

  // Banner — bold UPPERCASE on its own line, then half-width thin rule.
  doc.setFont('helvetica', TYPOGRAPHY.sectionHeader.weight);
  doc.setFontSize(TYPOGRAPHY.sectionHeader.size);
  doc.text(copy.bannerText, layout.leftX, layout.cursorY + 4);
  layout.advance(6);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(RULE_WEIGHTS.sectionRule);
  doc.line(layout.leftX, layout.cursorY, layout.rightX, layout.cursorY);
  layout.advance(2);

  // Body — 9pt regular text, ~4mm line height. Empty strings advance only.
  doc.setFont('helvetica', TYPOGRAPHY.fieldValue.weight);
  doc.setFontSize(TYPOGRAPHY.fieldValue.size);
  const lineH = 4;
  for (const line of copy.body) {
    layout.pageBreakIfNeeded(lineH);
    if (line.trim().length > 0) {
      doc.text(line, layout.leftX, layout.cursorY);
    }
    layout.advance(lineH);
  }

  doc.restoreGraphicsState();
}
