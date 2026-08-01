import type { jsPDF } from 'jspdf';
// Plain pdfjs-dist, matching the two existing call sites:
// client/src/lib/rmpg-pdf-engine/backends/pdfjs.ts and
// client/src/pages/ServeIntakePage.tsx. This module does real canvas
// rasterization in the browser, so it must use the same build the product
// actually ships with — no second, divergent pdfjs build for a harness
// whose entire value is "what renders here is what prints."
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PRINT_SCALE, marginGuideRect } from './renderGeometry';
import type { GuideRect } from './renderGeometry';

// Re-exported so existing/future imports of these from renderToCanvas.ts
// keep working; the canonical, pdfjs-free definitions live in
// renderGeometry.ts.
export { PRINT_SCALE, marginGuideRect };
export type { GuideRect };

// Module-level worker registration, same pattern as
// client/src/lib/rmpg-pdf-engine/backends/pdfjs.ts and
// client/src/pages/ServeIntakePage.tsx — do not invent a second
// worker configuration.
try {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('[pdf-gallery] Failed to set pdfjs worker URL.', err);
}

export async function renderPdfToCanvases(doc: jsPDF, scale = PRINT_SCALE): Promise<HTMLCanvasElement[]> {
  const data = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  const pdf = await pdfjs.getDocument({ data }).promise;
  const canvases: HTMLCanvasElement[] = [];

  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    // Margin guide, drawn after the page so it sits on top. Any glyph
    // crossing this line is an overflow defect.
    const base = page.getViewport({ scale: 1 });
    const guide = marginGuideRect(base.width, base.height, 36, scale);
    ctx.save();
    ctx.strokeStyle = '#e11d48';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(guide.x, guide.y, guide.width, guide.height);
    ctx.restore();

    canvases.push(canvas);
  }
  return canvases;
}
