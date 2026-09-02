import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { isImageMime, isPdfBytes } from './tesseractDocMime';

export { isImageMime, isPdfBytes };

try {
  GlobalWorkerOptions.workerSrc = workerUrl;
} catch {
  /* jsdom / Node — fake worker is fine for unit tests that never render */
}

export const TRAINING_RASTER_SCALE = 2;
export const TRAINING_RASTER_JPEG_QUALITY = 0.82;
/** Cap uploaded training rasters so a 40-page docket cannot blow the Worker body limit. */
export const MAX_TRAINING_RASTER_PAGES = 10;

export async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({ data, verbosity: 0 }).promise;
}

export async function renderPdfPageToBlob(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  opts: { scale?: number; quality?: number } = {},
): Promise<{ blob: Blob; width: number; height: number }> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: opts.scale ?? TRAINING_RASTER_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]).promise;
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to rasterize PDF page'))),
      'image/jpeg',
      opts.quality ?? TRAINING_RASTER_JPEG_QUALITY,
    );
  });
  const width = canvas.width;
  const height = canvas.height;
  canvas.width = 0;
  canvas.height = 0;
  return { blob, width, height };
}

export async function rasterizePdfPagesForTraining(
  data: Uint8Array,
  maxPages = MAX_TRAINING_RASTER_PAGES,
): Promise<Array<{ pageNumber: number; file: File }>> {
  const pdf = await openPdf(data);
  const count = Math.min(pdf.numPages, maxPages);
  const out: Array<{ pageNumber: number; file: File }> = [];
  for (let i = 1; i <= count; i++) {
    const { blob } = await renderPdfPageToBlob(pdf, i);
    out.push({
      pageNumber: i,
      file: new File([blob], `page-${String(i).padStart(3, '0')}.jpg`, { type: 'image/jpeg' }),
    });
  }
  return out;
}
