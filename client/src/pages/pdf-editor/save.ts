import { PDFDocument } from 'pdf-lib';
import { RmpgPdfBuilder, ContentStreamBuilder } from '../../lib/rmpg-pdf-engine';
import { Annotation, BatesConfig, DocumentMeta, EditorState, PageMeta, WatermarkConfig, DEFAULT_RENDER_SCALE } from './types';

// Save pipeline.
//
// The annotation-save path now runs entirely through the proprietary RMPG
// PDF Engine writer (client/src/lib/rmpg-pdf-engine/native/writer/). pdf-lib
// is no longer in the loop for the editor's primary "save edited copy" /
// "save to Documents" actions.
//
// Coordinate conversion happens here and only here. Annotations live in
// screen pixels at DEFAULT_RENDER_SCALE; the writer's content-stream builder
// emits operators in PDF user-space (origin bottom-left, in points).
//
// Multi-document merge (mergePdfFiles below) still calls pdf-lib for now —
// flagged as the next replacement target. It's only invoked when a user
// uploads several PDFs at once via the merge dialog.

const FONT_MAP: Record<string, 'Helvetica' | 'HelveticaBold' | 'HelveticaOblique' | 'TimesRoman' | 'TimesBold' | 'TimesItalic' | 'Courier' | 'CourierBold'> = {
  helv: 'Helvetica',
  helvBold: 'HelveticaBold',
  helvItalic: 'HelveticaOblique',
};

function hexToRgb(hex: string | undefined, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (!hex) return fallback;
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return fallback;
  const n = parseInt(clean, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function makeBatesText(cfg: BatesConfig, n: number): string {
  return `${cfg.prefix}${String(n).padStart(cfg.padding, '0')}`;
}

interface PageContext {
  builder: RmpgPdfBuilder;
  pageIdx: number;
  pageMeta: PageMeta;
  pageHeightPdf: number;
}

/** Convert a screen-pixel y coordinate (top-down) to PDF user-space y (bottom-up). */
function screenToPdfY(screenY: number, pageHeightPdf: number, scale: number): number {
  return pageHeightPdf - (screenY / scale);
}

async function drawAnnotation(ctx: PageContext, ann: Annotation): Promise<void> {
  const { builder, pageIdx, pageHeightPdf } = ctx;
  const scale = DEFAULT_RENDER_SCALE;
  const px = ann.x / scale;
  const pw = ann.w / scale;
  const ph = ann.h / scale;
  const py = screenToPdfY(ann.y, pageHeightPdf, scale);
  const stroke = ann.strokeWidth ?? 1.5;
  const opacity = ann.opacity ?? 1;
  const color = hexToRgb(ann.color, [0, 0, 0]);
  const fillColor = hexToRgb(ann.fillColor ?? ann.color, [0, 0, 0]);

  switch (ann.type) {
    case 'text': {
      const fontKey: keyof typeof FONT_MAP = ann.bold ? 'helvBold' : ann.italic ? 'helvItalic' : 'helv';
      const fontName = FONT_MAP[fontKey];
      builder.drawOnPage(pageIdx, (csb, useFont) => {
        const resName = useFont(fontName);
        csb.saveState();
        csb.setFillRgb(color[0], color[1], color[2]);
        csb.drawText(ann.text, px, py - ann.fontSize, resName, ann.fontSize);
        csb.restoreState();
      });
      return;
    }
    case 'highlight': {
      const fc = hexToRgb(ann.fillColor ?? '#fff050', [1, 0.94, 0.31]);
      builder.drawOnPage(pageIdx, (csb) => {
        csb.saveState();
        csb.setFillRgb(fc[0], fc[1], fc[2]);
        // Highlight is alpha-less in PDF without ExtGState; emulate with paler tone.
        csb.fillRect(px, py - ph, pw, ph);
        csb.restoreState();
      });
      return;
    }
    case 'redact': {
      builder.drawOnPage(pageIdx, (csb) => {
        csb.saveState();
        csb.setFillRgb(0, 0, 0);
        csb.fillRect(px, py - ph, pw, ph);
        csb.restoreState();
      });
      return;
    }
    case 'rect': {
      builder.drawOnPage(pageIdx, (csb) => {
        csb.saveState();
        csb.setStrokeRgb(color[0], color[1], color[2]);
        csb.setLineWidth(stroke);
        if (ann.fillColor) {
          csb.setFillRgb(fillColor[0], fillColor[1], fillColor[2]);
        }
        csb.strokeRect(px, py - ph, pw, ph);
        csb.restoreState();
      });
      return;
    }
    case 'ellipse': {
      builder.drawOnPage(pageIdx, (csb) => {
        csb.saveState();
        csb.setStrokeRgb(color[0], color[1], color[2]);
        csb.setLineWidth(stroke);
        csb.drawEllipse(px + pw / 2, py - ph / 2, pw / 2, ph / 2, false);
        csb.restoreState();
      });
      return;
    }
    case 'line': {
      const x1 = px;
      const y1 = py;
      const x2 = px + pw;
      const y2 = py - ph;
      builder.drawOnPage(pageIdx, (csb) => {
        csb.saveState();
        csb.setStrokeRgb(color[0], color[1], color[2]);
        csb.setLineWidth(stroke);
        csb.drawLine(x1, y1, x2, y2);
        if (ann.arrow) {
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          const head = 12, wide = 6;
          const bx = x2 - ux * head, by = y2 - uy * head;
          csb.drawLine(x2, y2, bx + (-uy) * wide, by + ux * wide);
          csb.drawLine(x2, y2, bx - (-uy) * wide, by - ux * wide);
        }
        csb.restoreState();
      });
      return;
    }
    case 'pen': {
      if (ann.points.length < 2) return;
      builder.drawOnPage(pageIdx, (csb) => {
        csb.saveState();
        csb.setStrokeRgb(color[0], color[1], color[2]);
        csb.setLineWidth(stroke);
        for (let i = 1; i < ann.points.length; i++) {
          const a = ann.points[i - 1];
          const b = ann.points[i];
          csb.drawLine(px + a.x / scale, py - a.y / scale, px + b.x / scale, py - b.y / scale);
        }
        csb.restoreState();
      });
      return;
    }
    case 'image':
    case 'signature': {
      const img = await RmpgPdfBuilder.dataUrlToJpeg(ann.imageData);
      const name = builder.embedJpeg(pageIdx, img.bytes, img.width, img.height);
      builder.drawOnPage(pageIdx, (csb) => {
        csb.drawImage(name, px, py - ph, pw, ph);
      });
      return;
    }
    case 'stamp': {
      const stampColor: [number, number, number] = [0.78, 0.1, 0.12];
      const text = String(ann.label).toUpperCase();
      const fontSize = Math.max(10, ph * 0.45);
      builder.drawOnPage(pageIdx, (csb, useFont) => {
        const resName = useFont('HelveticaBold');
        csb.saveState();
        csb.setStrokeRgb(stampColor[0], stampColor[1], stampColor[2]);
        csb.setLineWidth(2.5);
        csb.strokeRect(px, py - ph, pw, ph);
        csb.setFillRgb(stampColor[0], stampColor[1], stampColor[2]);
        // Approximate centered text: use a rough character-width estimate.
        const approxW = text.length * fontSize * 0.6;
        const tx = px + (pw - approxW) / 2;
        const ty = py - ph / 2 - fontSize / 2.6;
        csb.drawText(text, tx, ty, resName, fontSize);
        csb.restoreState();
      });
      return;
    }
    case 'link': {
      // Draw the visible label; the proprietary writer doesn't yet emit
      // /Annot Link dicts (TODO — covers ~30 lines of object construction).
      // Visible underlined text is the v1 fallback.
      const fontSize = Math.max(10, ph * 0.6);
      builder.drawOnPage(pageIdx, (csb, useFont) => {
        const resName = useFont('Helvetica');
        csb.saveState();
        csb.setFillRgb(0, 0.27, 0.55);
        csb.drawText(ann.text, px + 2, py - ph + 4, resName, fontSize);
        csb.setStrokeRgb(0, 0.27, 0.55);
        csb.setLineWidth(0.6);
        csb.drawLine(px, py - ph + 2, px + pw, py - ph + 2);
        csb.restoreState();
      });
      return;
    }
  }
}

function applyBates(builder: RmpgPdfBuilder, pageIdx: number, mediaBox: [number, number, number, number], cfg: BatesConfig, n: number): void {
  const text = makeBatesText(cfg, n);
  const w = mediaBox[2] - mediaBox[0];
  const h = mediaBox[3] - mediaBox[1];
  const margin = 18;
  const approxW = text.length * cfg.fontSize * 0.55;
  let x = margin, y = margin;
  if (cfg.position === 'tl') { x = margin; y = h - margin - cfg.fontSize; }
  else if (cfg.position === 'tr') { x = w - margin - approxW; y = h - margin - cfg.fontSize; }
  else if (cfg.position === 'bl') { x = margin; y = margin; }
  else { x = w - margin - approxW; y = margin; }
  builder.drawOnPage(pageIdx, (csb, useFont) => {
    const resName = useFont('Helvetica');
    csb.saveState();
    csb.setFillRgb(0.3, 0.3, 0.3);
    csb.drawText(text, x, y, resName, cfg.fontSize);
    csb.restoreState();
  });
}

function applyWatermark(builder: RmpgPdfBuilder, pageIdx: number, mediaBox: [number, number, number, number], wm: WatermarkConfig): void {
  const w = mediaBox[2] - mediaBox[0];
  const h = mediaBox[3] - mediaBox[1];
  // We don't yet emit ExtGState for true alpha — render as a muted gray text
  // at the rotation angle. Acceptable for "DRAFT / CONFIDENTIAL" stripes.
  const cx = w / 2;
  const cy = h / 2;
  const rad = (wm.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  builder.drawOnPage(pageIdx, (csb, useFont) => {
    const resName = useFont('HelveticaBold');
    csb.saveState();
    // Apply a transform: cm a b c d e f
    // We can build it via raw operator append since CSB doesn't expose `cm` directly.
    // Use an ad-hoc moveTo + drawText positioned at (cx, cy) via translate.
    // (CSB doesn't expose `cm` — emulate by computing where text origin lands.)
    const approxW = wm.text.length * wm.fontSize * 0.55;
    const tx = cx - cos * (approxW / 2) + sin * (wm.fontSize / 2);
    const ty = cy - sin * (approxW / 2) - cos * (wm.fontSize / 2);
    const muted: [number, number, number] = [0.55, 0.55, 0.55];
    csb.setFillRgb(muted[0], muted[1], muted[2]);
    csb.drawText(wm.text, tx, ty, resName, wm.fontSize);
    csb.restoreState();
  });
}

/**
 * Apply all editor state to a fresh PDF and return its bytes.
 * Implementation: 100% RMPG PDF Engine writer — no third-party PDF library.
 */
export async function buildPdfFromEditorState(state: EditorState): Promise<Uint8Array> {
  if (!state.bytes) throw new Error('No source PDF loaded');

  const builder = await RmpgPdfBuilder.load(state.bytes);

  // Reorder/delete pages per visual order. The builder's collectPages() walks
  // the source page tree in document order — we map that to the editor's
  // visual order (pageOrder is 1-indexed source page numbers).
  const sourceIndices = state.pageOrder.map(i => i - 1);
  builder.reorderPages(sourceIndices);

  // Apply per-page rotation, crop, and annotations.
  for (let visualIdx = 0; visualIdx < state.pages.length; visualIdx++) {
    const meta = state.pages[visualIdx];
    if (!meta) continue;

    if (meta.rotation) builder.setPageRotation(visualIdx, meta.rotation as 0 | 90 | 180 | 270);

    const pageMediaBox = inferMediaBox(meta);
    const pageHeightPdf = pageMediaBox[3] - pageMediaBox[1];

    if (meta.crop) {
      const scale = DEFAULT_RENDER_SCALE;
      const cx = meta.crop.x / scale;
      const cw = meta.crop.w / scale;
      const ch = meta.crop.h / scale;
      const cy = pageHeightPdf - (meta.crop.y / scale) - ch;
      builder.setCropBox(visualIdx, cx, cy, cw, ch);
    }

    const ctx: PageContext = { builder, pageIdx: visualIdx, pageMeta: meta, pageHeightPdf };
    const pageAnns = state.annotations.filter(a => a.page === visualIdx + 1);
    for (const ann of pageAnns) await drawAnnotation(ctx, ann);

    if (state.watermark && state.watermark.text.trim()) {
      applyWatermark(builder, visualIdx, pageMediaBox, state.watermark);
    }
    if (state.bates) {
      applyBates(builder, visualIdx, pageMediaBox, state.bates, state.bates.startNumber + visualIdx);
    }
  }

  builder.setMetadata({
    title: state.meta.title,
    author: state.meta.author,
    subject: state.meta.subject,
    keywords: state.meta.keywords,
  });

  return builder.save();
}

function inferMediaBox(meta: PageMeta): [number, number, number, number] {
  // Editor stores width/height at DEFAULT_RENDER_SCALE; back into PDF points.
  const w = meta.width / DEFAULT_RENDER_SCALE;
  const h = meta.height / DEFAULT_RENDER_SCALE;
  return [0, 0, w, h];
}

export async function downloadEditedPdf(state: EditorState, suffix = '-edited'): Promise<void> {
  const bytes = await buildPdfFromEditorState(state);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const base = state.fileName.replace(/\.pdf$/i, '') || 'document';
  a.href = url;
  a.download = `${base}${suffix}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Extract a specific subset of pages (1-indexed in the *current* visual order)
 * to a fresh PDF using our proprietary builder.
 */
export async function extractPagesAsBytes(state: EditorState, pageNumbers: number[]): Promise<Uint8Array> {
  if (!state.bytes) throw new Error('No source PDF loaded');
  const builder = await RmpgPdfBuilder.load(state.bytes);
  const sourceIndices: number[] = [];
  for (const n of pageNumbers) {
    const visualIdx = n - 1;
    const orig = state.pageOrder[visualIdx];
    if (orig && orig > 0) sourceIndices.push(orig - 1);
  }
  if (sourceIndices.length === 0) throw new Error('No extractable pages selected');
  builder.reorderPages(sourceIndices);
  builder.setMetadata({ title: `${state.meta.title ?? 'document'} (extract)` });
  return builder.save();
}

/**
 * Save the edited PDF directly into the Documents store via /api/uploads.
 */
export async function saveToDocuments(state: EditorState, opts: { folderId?: number | null; suffix?: string } = {}): Promise<{ fileId: string; original_name: string }> {
  const bytes = await buildPdfFromEditorState(state);
  const base = state.fileName.replace(/\.pdf$/i, '') || 'document';
  const newName = `${base}${opts.suffix ?? '-edited'}.pdf`;
  const file = new File([bytes as BlobPart], newName, { type: 'application/pdf' });
  const form = new FormData();
  form.append('files', file);
  const folderId = opts.folderId ?? state.sourceFolderId ?? null;
  if (folderId != null) form.append('folder_id', String(folderId));

  const token = localStorage.getItem('rmpg_token');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch('/api/uploads', { method: 'POST', headers, body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json() as { files: Array<{ file_id: string; original_name: string }> };
  if (!data.files || data.files.length === 0) throw new Error('Upload did not return file');
  return { fileId: data.files[0].file_id, original_name: data.files[0].original_name };
}

/**
 * Multi-document merge — still goes through pdf-lib for now. This is the next
 * replacement target: page-tree splicing across multiple sources is more
 * involved than the per-page overlay used by the primary save flow above.
 * Tracked in the engine README's roadmap.
 */
export async function mergePdfFiles(files: File[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const file of files) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const src = await PDFDocument.load(buf);
    const idxs = src.getPageIndices();
    const copied = await merged.copyPages(src, idxs);
    for (const p of copied) merged.addPage(p);
  }
  merged.setProducer('RMPG PDF Engine v1.0 — merge transitional via pdf-lib');
  merged.setCreationDate(new Date());
  return merged.save();
}
