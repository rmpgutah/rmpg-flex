import type { jsPDF } from 'jspdf';
// The legacy build works in both the browser and plain Node (vitest) — see
// client/src/utils/pdf/audit/textLayer.ts for the same choice and rationale.
// The non-legacy build references DOMMatrix at module scope, which throws
// under vitest's environment before a single test runs.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

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

// pdfjs measures at 72 DPI; 150 DPI is the lowest scale at which 6pt
// form-label text is legible enough to judge clipping by eye.
export const PRINT_SCALE = 150 / 72;

export interface GuideRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function marginGuideRect(
  pageWidthPt: number,
  pageHeightPt: number,
  marginPt: number,
  scale: number,
): GuideRect {
  return {
    x: marginPt * scale,
    y: marginPt * scale,
    width: Math.max(0, (pageWidthPt - marginPt * 2) * scale),
    height: Math.max(0, (pageHeightPt - marginPt * 2) * scale),
  };
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
