// safeRender — open + render a PDF page with automatic PDF.js fallback if
// the native engine fails *during render* (after open() succeeded).
//
// The dispatcher in index.ts already falls back to PDF.js at open() time
// when NativeBackend throws BackendUnsupportedError. But a document can
// still pass open-time validation and then trip rendering on something
// the pre-flight scan missed (a font path, a content-stream edge case).
// Without this helper, render-time exceptions get swallowed by the
// component's catch and the page silently ends up blank.
//
// This helper:
//   1. Tries open + render via the auto dispatcher (native first)
//   2. On any error, destroys the partial document and retries with
//      `{ backend: 'pdfjs' }` so the document opens through PDF.js
//      and re-renders into the same canvas
//   3. Returns the document (so callers can run getTextContent etc.)
//      or null if both backends failed

import { open as openPdf, RmpgPdfDocument } from './index';

export interface SafeRenderOptions {
  pageNumber: number;
  scale: number;
  canvas: HTMLCanvasElement;
  fileName?: string;
}

export async function openAndRenderPage(
  bytes: Uint8Array,
  opts: SafeRenderOptions,
): Promise<RmpgPdfDocument | null> {
  const tryOnce = async (forceFallback: boolean): Promise<RmpgPdfDocument> => {
    const pdf = await openPdf(bytes, {
      fileName: opts.fileName,
      backend: forceFallback ? 'pdfjs' : 'auto',
    });
    try {
      const page = await pdf.getPage(opts.pageNumber);
      await page.render({ scale: opts.scale, canvas: opts.canvas });
      return pdf;
    } catch (renderErr) {
      // Free the partial document, then bubble up so the caller can decide
      // whether to retry with the explicit fallback.
      try { await pdf.destroy(); } catch { /* ignore */ }
      throw renderErr;
    }
  };

  try {
    return await tryOnce(false);
  } catch (firstErr) {
    console.warn('[rmpg-pdf-engine] auto backend failed during render — falling back to PDF.js', firstErr);
    try {
      return await tryOnce(true);
    } catch (secondErr) {
      console.error('[rmpg-pdf-engine] PDF.js fallback also failed', secondErr);
      return null;
    }
  }
}
