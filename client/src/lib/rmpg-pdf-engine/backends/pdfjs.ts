// PDF.js fallback backend.
//
// Wraps Mozilla's PDF.js (Apache 2.0) to implement our RmpgPdfBackend
// interface. PDF.js is the only mass-deployed open-source PDF engine that
// covers the long tail of real-world PDFs (encrypted, image-only, JBIG2,
// JPEG2000, custom CFF/TrueType fonts, transparency groups, etc.) so we
// keep it as the safety net while the native backend's coverage grows.
//
// This is the only file in the codebase that imports pdfjs-dist directly.
// Everything else goes through the engine facade.

import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  PageViewport,
  RenderOptions,
  RmpgPdfBackend,
  RmpgPdfDocument,
  RmpgPdfPage,
  RmpgPdfError,
  TextItem,
} from '../types';

// Module-level worker registration. PDF.js requires this once per realm.
try {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
} catch (err) {
  console.warn('[rmpg-pdf:pdfjs] Failed to set worker URL — using fake-worker mode.', err);
}

class PdfJsPage implements RmpgPdfPage {
  constructor(public pageNumber: number, private inner: pdfjs.PDFPageProxy) {}

  getViewport({ scale }: { scale: number }): PageViewport {
    const v = this.inner.getViewport({ scale });
    return { width: v.width, height: v.height, scale, rotation: v.rotation };
  }

  async render({ scale, canvas: incomingCanvas }: RenderOptions): Promise<HTMLCanvasElement> {
    const viewport = this.inner.getViewport({ scale });
    const canvas = incomingCanvas ?? document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new RmpgPdfError('2D canvas context unavailable');
    // Paint a white background BEFORE handing the canvas to PDF.js. Without
    // this, transparent-background PDFs render with the editor's dark page
    // surface showing through — operators see "black pages" even though
    // PDF.js's render call succeeded. NativePage.render does the same fill.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await this.inner.render({ canvasContext: ctx, viewport, canvas }).promise;
    return canvas;
  }

  async getTextContent(): Promise<TextItem[]> {
    try {
      const content = await this.inner.getTextContent();
      const items: TextItem[] = [];
      for (const raw of content.items) {
        const it = raw as { str?: string; transform: number[]; width: number; height: number };
        if (typeof it.str !== 'string' || it.str.length === 0) continue;
        const t = it.transform;
        items.push({
          str: it.str,
          transform: [t[0], t[1], t[2], t[3], t[4], t[5]],
          width: it.width,
          height: it.height,
        });
      }
      return items;
    } catch {
      // Image-only / scanned PDFs surface no text content.
      return [];
    }
  }
}

class PdfJsDocument implements RmpgPdfDocument {
  readonly backend = 'pdfjs' as const;
  constructor(
    private inner: pdfjs.PDFDocumentProxy,
    public backendReason: string,
  ) {}

  get numPages(): number { return this.inner.numPages; }

  async getPage(pageNumber: number): Promise<RmpgPdfPage> {
    const p = await this.inner.getPage(pageNumber);
    return new PdfJsPage(pageNumber, p);
  }

  async destroy(): Promise<void> {
    try { await this.inner.destroy(); } catch { /* ignore */ }
  }
}

export class PdfJsBackend implements RmpgPdfBackend {
  readonly name = 'pdfjs' as const;

  async open(bytes: Uint8Array): Promise<RmpgPdfDocument> {
    try {
      // Provide standardFontDataUrl + cMapUrl. PDF.js v5 does NOT bundle the
      // Standard 14 font fallbacks (Helvetica, Times, Courier, Symbol,
      // ZapfDingbats) into the worker — they live in pdfjs-dist/standard_fonts/
      // and must be served at runtime. Without these URLs set, render()
      // throws on every PDF that references those fonts without embedding.
      // The assets are copied into client/public/pdfjs/ at build time by
      // scripts/copy-pdfjs-assets.mjs.
      const inner = await pdfjs.getDocument({
        data: bytes.slice(),
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        // For in-memory bytes (which is always our case — files come from
        // /api/uploads as ArrayBuffer), disableStream + disableAutoFetch
        // is the documented correct setting. Streaming was causing
        // RangeError / AbortException issues with merged-pdf-lib output.
        disableStream: true,
        disableAutoFetch: true,
        // XFA: render the static visual layer of court-issued forms.
        // Safe even on non-XFA documents — PDF.js no-ops the flag.
        enableXfa: true,
        // Surface PDF.js warnings/errors at console level so they make
        // it into the diagnostic logs.
        verbosity: 1,
      }).promise;
      return new PdfJsDocument(inner, 'pdfjs backend (Mozilla, Apache 2.0)');
    } catch (err) {
      throw new RmpgPdfError(`PDF.js failed to open document: ${err instanceof Error ? err.message : String(err)}`, err);
    }
  }
}

export const pdfjsBackend = new PdfJsBackend();
