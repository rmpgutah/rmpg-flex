// ============================================================
// utahMasterRenderer — multi-copy full-page renderer for the
// Utah master citation form
// ============================================================
// Differs from multiCopy.ts in that each copy variant gets a FULL
// PAGE rather than a half-page fold. Copies share the same form
// data; the only per-page difference is the bottom-strip copy
// designation (court / agency / defendant / file).
//
// The 4 copies are rendered into ONE jsPDF instance via addPage(),
// yielding a single 4-page PDF blob. Individual copy PDFs are
// derived by extracting individual pages via doc.deletePage() in
// `splitCopiesToBlobs()` — used to upload each copy separately to R2.

import jsPDF from 'jspdf';
import { renderPdfV2, type RenderOptions } from './engine/renderer';
import { embedSidecar, outputWithSidecar, type SidecarPayload, type SidecarSignature } from './engine/sidecar';
import {
  citationUtahMasterSchema,
  COPY_STRIP_LABELS,
  type CitationUtahData,
  type CitationCopyKind,
} from './forms/citationUtahMaster';

export const ALL_COPY_KINDS: CitationCopyKind[] = ['court', 'agency', 'defendant', 'file'];

/**
 * Draw the copy-designation strip at the page bottom, just above the footer.
 * Page-anchored (not section-anchored) so it doesn't shift when the form
 * content varies in height.
 *
 * Positioned at y = pageHeight - 25mm, h = 7mm. Footer starts at
 * pageHeight - 18mm. So the strip sits in the 7mm band above the footer.
 */
function drawCopyStrip(doc: jsPDF, copyKind: CitationCopyKind): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const leftMargin = 10;
  const stripY = pageHeight - 25;
  const stripH = 7;
  const stripW = pageWidth - 2 * leftMargin;

  doc.saveGraphicsState();
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(1.5);   // matches RULE_WEIGHTS.headerThick — bold border
  doc.rect(leftMargin, stripY, stripW, stripH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(COPY_STRIP_LABELS[copyKind], leftMargin + stripW / 2, stripY + stripH - 2, { align: 'center' });
  doc.restoreGraphicsState();
}

export interface UtahMasterRenderOptions extends RenderOptions {
  /** Copy variants to include in the output, in page order. Defaults to all 4. */
  copyKinds?: CitationCopyKind[];
  /** Schema id for sidecar; defaults to 'citation-utah-master'. */
  schemaId?: string;
  /** Pre-computed Ed25519 signature for the sidecar. */
  signature?: SidecarSignature;
}

/**
 * Render the Utah master citation as a multi-copy PDF — one full page
 * per copy variant. The first copy's page is created by jsPDF's
 * constructor; subsequent copies get addPage() calls.
 *
 * NB: passing the same `data` object with a per-page `__copyKind`
 * mutation would force each copy to share schema state. We sidestep
 * that by spreading into a fresh object per page so the schema reads
 * the right copyKind each time.
 */
export async function renderUtahMasterMultiCopyPdf(
  data: CitationUtahData,
  options: UtahMasterRenderOptions = {},
): Promise<jsPDF> {
  const copyKinds = options.copyKinds ?? ALL_COPY_KINDS;
  if (copyKinds.length === 0) {
    throw new Error('renderUtahMasterMultiCopyPdf: at least one copyKind required');
  }

  // Render copy 1 via renderPdfV2 — it creates the jsPDF instance with the
  // first page already populated.
  const firstData: CitationUtahData = { ...data, __copyKind: copyKinds[0] };
  const doc = await renderPdfV2(citationUtahMasterSchema, firstData, {
    generatedAt: options.generatedAt,
    coreFontsOnly: options.coreFontsOnly,
  });
  // Stamp copy strip on page 1
  doc.setPage(1);
  drawCopyStrip(doc, copyKinds[0]);

  // Append remaining copies as new pages on the same jsPDF instance. Each
  // subsequent copy calls into the underlying header + sections + footer
  // path manually — we don't want renderPdfV2 to create a new doc.
  for (let i = 1; i < copyKinds.length; i++) {
    doc.addPage();
    await renderCopyPage(doc, { ...data, __copyKind: copyKinds[i] }, options);
    drawCopyStrip(doc, copyKinds[i]);
  }

  return doc;
}

/**
 * Render a single copy's page onto the doc's CURRENT page. The page
 * must already exist (addPage was just called by the caller).
 *
 * Implementation note: we don't want to recreate the whole renderPdfV2
 * machinery for in-place rendering. Instead we re-run the same pipeline
 * pieces — drawDefaultHeader, layout engine, section loop, footer —
 * just bound to the existing doc.
 */
async function renderCopyPage(
  doc: jsPDF,
  data: CitationUtahData,
  options: UtahMasterRenderOptions,
): Promise<void> {
  // Re-imports to avoid pulling in the full renderer module surface:
  const { drawDefaultHeader } = await import('./engine/header');
  const { drawDefaultFooter } = await import('./engine/footer');
  const { LayoutEngine } = await import('./engine/layout');
  const { Primitives } = await import('./engine/primitives');
  const { makeRenderContext, drawSectionHeader, closeSection } = await import('./engine/context');
  const { renderSectionFields } = await import('./engine/renderer');
  const { renderFixedLayoutSection } = await import('./engine/fixedLayout');
  const { drawBlankFormWatermark, drawDraftWatermark } = await import('./engine/watermark');
  void options.coreFontsOnly; // already controlled by the initial renderPdfV2 call

  const schema = citationUtahMasterSchema;
  if (schema.watermark) {
    if (schema.watermark === 'blank-form') drawBlankFormWatermark(doc);
    else if (schema.watermark === 'draft') drawDraftWatermark(doc);
  }
  const headerBottomY = drawDefaultHeader(doc, schema.meta, {
    caseNumber: schema.header.caseNumberAccessor?.(data),
    caseLabel: schema.header.caseLabel,
  });
  const layout = new LayoutEngine(doc, {
    topMargin: headerBottomY + 4,
    bottomMargin: 18,
    leftMargin: 10,
    rightMargin: 10,
  });
  const prims = new Primitives(doc, layout);
  for (const section of schema.sections) {
    if (typeof section === 'function') {
      const ctx = makeRenderContext(doc, layout, prims, data);
      section(ctx, data);
    } else if ((section as any).kind === 'fixed-layout') {
      const fixed = section as any;
      if (fixed.visibleIf && !fixed.visibleIf(data)) continue;
      renderFixedLayoutSection(doc, layout, fixed, data);
    } else {
      const s = section as any;
      if (s.visibleIf && !s.visibleIf(data)) continue;
      drawSectionHeader(doc, layout, s.title);
      renderSectionFields(prims, layout, s, data);
      closeSection(layout);
    }
  }
  // Stamp footer for THIS page only — renderPdfV2's outer-loop footer pass
  // covers all pages at output time. For copy 2..N we add a footer
  // here so the per-page revision/form/page-number info is correct
  // before the outer pass runs.
  drawDefaultFooter(doc, {
    pageNumber: doc.getNumberOfPages(),
    totalPages: doc.getNumberOfPages(), // outer loop will re-stamp with real total
    revision: schema.meta.revision,
    formNumber: schema.meta.formNumber,
    generatedAt: options.generatedAt,
  });
}

/**
 * Render the multi-copy doc, embed sidecar, return final bytes. The
 * sidecar carries the CitationUtahData payload — extraction round-trip
 * yields the same canonical bytes.
 */
export async function renderUtahMasterMultiCopyBytes(
  data: CitationUtahData,
  options: UtahMasterRenderOptions = {},
): Promise<Uint8Array> {
  const doc = await renderUtahMasterMultiCopyPdf(data, options);
  // Final-pass footer overwrites with correct page totals after all
  // pages exist (mirror of renderPdfV2's behavior).
  const total = doc.getNumberOfPages();
  const { drawDefaultFooter } = await import('./engine/footer');
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawDefaultFooter(doc, {
      pageNumber: p,
      totalPages: total,
      revision: citationUtahMasterSchema.meta.revision,
      formNumber: citationUtahMasterSchema.meta.formNumber,
      generatedAt: options.generatedAt,
    });
  }
  if (options.schemaId !== null) {
    const payload: SidecarPayload = {
      v: 1,
      schemaId: options.schemaId ?? 'citation-utah-master',
      formNumber: citationUtahMasterSchema.meta.formNumber,
      caseNumber: data.citation_number ?? '',
      generatedAt: (options.generatedAt ?? new Date()).toISOString(),
      data: { ...data, __copyKind: undefined } as unknown,
      signature: options.signature,
    };
    embedSidecar(doc, payload);
    return outputWithSidecar(doc);
  }
  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
}

/**
 * Render the multi-copy doc and yield ONE individual PDF blob per
 * copy variant. Used by the issue flow: defendant copy goes to
 * print/share, the other three get uploaded to R2 individually so
 * each lives at its own R2 key.
 *
 * Implementation: render the full multi-copy doc, then for each
 * copy clone the doc and keep only that copy's page. Cloning via
 * `doc.output('arraybuffer')` → fresh jsPDF is too expensive; we
 * instead render each copy as its own single-page doc via
 * renderPdfV2 with the appropriate __copyKind, return per-copy blobs.
 */
export async function renderUtahMasterCopyBlobs(
  data: CitationUtahData,
  options: UtahMasterRenderOptions = {},
): Promise<Record<CitationCopyKind, Blob>> {
  const copyKinds = options.copyKinds ?? ALL_COPY_KINDS;
  const out: Partial<Record<CitationCopyKind, Blob>> = {};
  for (const copyKind of copyKinds) {
    const perCopyData: CitationUtahData = { ...data, __copyKind: copyKind };
    const doc = await renderPdfV2(citationUtahMasterSchema, perCopyData, {
      generatedAt: options.generatedAt,
      coreFontsOnly: options.coreFontsOnly,
    });
    // Stamp the per-copy designator strip at the page bottom (above the footer).
    drawCopyStrip(doc, copyKind);

    if (options.schemaId !== null) {
      const payload: SidecarPayload = {
        v: 1,
        schemaId: options.schemaId ?? 'citation-utah-master',
        formNumber: citationUtahMasterSchema.meta.formNumber,
        caseNumber: data.citation_number ?? '',
        generatedAt: (options.generatedAt ?? new Date()).toISOString(),
        data: { ...data, __copyKind: undefined } as unknown,
        signature: options.signature,
      };
      embedSidecar(doc, payload);
      const bytes = outputWithSidecar(doc);
      // Copy into a fresh ArrayBuffer to satisfy DOM Blob's BlobPart type.
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      out[copyKind] = new Blob([ab], { type: 'application/pdf' });
    } else {
      out[copyKind] = new Blob([doc.output('arraybuffer') as ArrayBuffer], { type: 'application/pdf' });
    }
  }
  return out as Record<CitationCopyKind, Blob>;
}

/**
 * Blob URL for the in-app PDF preview. Returns a multi-copy doc
 * (4 pages) with sidecar embedded. Caller is responsible for
 * revoking the URL.
 */
export async function utahMasterBlobUrl(
  data: CitationUtahData,
  options: UtahMasterRenderOptions = {},
): Promise<string> {
  const bytes = await renderUtahMasterMultiCopyBytes(data, options);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
}
