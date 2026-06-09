import { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib';
import { normRotation, rotationGeometry } from './rotationGeometry';
import { RmpgPdfBuilder, open as openEnginePdf } from '../../lib/rmpg-pdf-engine';
import { Annotation, BatesConfig, EditorState, HeaderFooterConfig, PageMeta, PageNumbersConfig, WatermarkConfig, DEFAULT_RENDER_SCALE } from './types';
import { normalizeUploadResponse } from './uploadResponse';

export { normalizeUploadResponse } from './uploadResponse';

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
  times: 'TimesRoman',
  timesBold: 'TimesBold',
  timesItalic: 'TimesItalic',
  courier: 'Courier',
  courierBold: 'CourierBold',
};

/** Pick the writer font key for a text annotation, honoring family + bold/italic. */
function textFontKey(family: 'helvetica' | 'times' | 'courier' | undefined, bold?: boolean, italic?: boolean): keyof typeof FONT_MAP {
  if (family === 'times') return bold ? 'timesBold' : italic ? 'timesItalic' : 'times';
  if (family === 'courier') return bold ? 'courierBold' : 'courier';
  return bold ? 'helvBold' : italic ? 'helvItalic' : 'helv';
}

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
  /** UNROTATED content height (points). */
  pageHeightPdf: number;
  /** UNROTATED content width (points). */
  pageWidthPdf: number;
}

/** Convert a screen-pixel y coordinate (top-down) to PDF user-space y (bottom-up). */
function screenToPdfY(screenY: number, pageHeightPdf: number, scale: number): number {
  return pageHeightPdf - (screenY / scale);
}

async function drawAnnotation(ctx: PageContext, ann: Annotation): Promise<void> {
  const { builder, pageIdx } = ctx;
  const scale = DEFAULT_RENDER_SCALE;
  // Page rotation: draw in the DISPLAYED frame (y-flip by the displayed height)
  // under a CTM that pre-compensates for /Rotate, so annotations land where the
  // user placed them on the rotated page. R=0 → ctm null → identical to before.
  const R = normRotation(ctx.pageMeta.rotation);
  const { dispH, ctm } = rotationGeometry(R, ctx.pageWidthPdf, ctx.pageHeightPdf);
  const pageHeightPdf = dispH;
  const px = ann.x / scale;
  const pw = ann.w / scale;
  const ph = ann.h / scale;
  const py = screenToPdfY(ann.y, pageHeightPdf, scale);
  const stroke = ann.strokeWidth ?? 1.5;
  const opacity = ann.opacity ?? 1;
  const color = hexToRgb(ann.color, [0, 0, 0]);
  const fillColor = hexToRgb(ann.fillColor ?? ann.color, [0, 0, 0]);

  // Every shape draws through this wrapper: saveState → (rotation CTM) → body →
  // restoreState. Centralizing the q/cm/Q here keeps each case self-contained
  // and guarantees the un-rotated path (ctm null) is byte-identical to before.
  const draw = (fn: Parameters<typeof builder.drawOnPage>[1]) =>
    builder.drawOnPage(pageIdx, (csb, useFont) => {
      csb.saveState();
      if (ctm) csb.transform(ctm[0], ctm[1], ctm[2], ctm[3], ctm[4], ctm[5]);
      fn(csb, useFont);
      csb.restoreState();
    });

  switch (ann.type) {
    case 'text': {
      const fontKey = textFontKey(ann.fontFamily, ann.bold, ann.italic);
      const fontName = FONT_MAP[fontKey];
      draw((csb, useFont) => {
        const resName = useFont(fontName);
        csb.setFillRgb(color[0], color[1], color[2]);
        csb.drawText(ann.text, px, py - ann.fontSize, resName, ann.fontSize);
      });
      return;
    }
    case 'highlight': {
      // Highlight rendered as a neutral gray overlay — no color splash.
      // Without ExtGState we can't do true alpha; use a light gray fill.
      const fc = hexToRgb(ann.fillColor ?? '#999999', [0.6, 0.6, 0.6]);
      draw((csb) => {
        csb.setFillRgb(fc[0], fc[1], fc[2]);
        csb.fillRect(px, py - ph, pw, ph);
      });
      return;
    }
    case 'underline':
    case 'strikethrough': {
      // Thin filled rule using the markup color. Underline sits on the box's
      // bottom edge; strikethrough runs through the vertical center.
      const th = Math.max(0.5, stroke);
      const ruleY = ann.type === 'underline' ? py - ph : py - ph / 2 - th / 2;
      draw((csb) => {
        csb.setFillRgb(color[0], color[1], color[2]);
        csb.fillRect(px, ruleY, pw, th);
      });
      return;
    }
    case 'redact': {
      draw((csb) => {
        csb.setFillRgb(0, 0, 0);
        csb.fillRect(px, py - ph, pw, ph);
      });
      return;
    }
    case 'rect': {
      draw((csb) => {
        csb.setStrokeRgb(color[0], color[1], color[2]);
        csb.setLineWidth(stroke);
        if (ann.fillColor) {
          csb.setFillRgb(fillColor[0], fillColor[1], fillColor[2]);
        }
        csb.strokeRect(px, py - ph, pw, ph);
      });
      return;
    }
    case 'ellipse': {
      draw((csb) => {
        csb.setStrokeRgb(color[0], color[1], color[2]);
        csb.setLineWidth(stroke);
        csb.drawEllipse(px + pw / 2, py - ph / 2, pw / 2, ph / 2, false);
      });
      return;
    }
    case 'line': {
      const x1 = px;
      const y1 = py;
      const x2 = px + pw;
      const y2 = py - ph;
      draw((csb) => {
        csb.setStrokeRgb(color[0], color[1], color[2]);
        csb.setLineWidth(stroke);
        csb.drawLine(x1, y1, x2, y2);
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        if (ann.arrow) {
          const head = 12, wide = 6;
          const bx = x2 - ux * head, by = y2 - uy * head;
          csb.drawLine(x2, y2, bx + (-uy) * wide, by + ux * wide);
          csb.drawLine(x2, y2, bx - (-uy) * wide, by - ux * wide);
        }
        // Measurement dimension line: perpendicular tick marks at both ends
        // plus the distance label drawn at the midpoint.
        if (ann.measureLabel) {
          const nx = -uy, ny = ux;       // perpendicular unit
          const tick = 5;
          csb.drawLine(x1 + nx * tick, y1 + ny * tick, x1 - nx * tick, y1 - ny * tick);
          csb.drawLine(x2 + nx * tick, y2 + ny * tick, x2 - nx * tick, y2 - ny * tick);
        }
      });
      if (ann.measureLabel) {
        draw((csb, useFont) => {
          const resName = useFont('Helvetica');
          csb.setFillRgb(color[0], color[1], color[2]);
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2 + 4;
          csb.drawText(ann.measureLabel!, mx, my, resName, 8);
        });
      }
      return;
    }
    case 'pen': {
      if (ann.points.length < 2) return;
      draw((csb) => {
        csb.setStrokeRgb(color[0], color[1], color[2]);
        csb.setLineWidth(stroke);
        for (let i = 1; i < ann.points.length; i++) {
          const a = ann.points[i - 1];
          const b = ann.points[i];
          csb.drawLine(px + a.x / scale, py - a.y / scale, px + b.x / scale, py - b.y / scale);
        }
      });
      return;
    }
    case 'polygon': {
      if (ann.points.length < 2) return;
      draw((csb) => {
        csb.setStrokeRgb(color[0], color[1], color[2]);
        csb.setLineWidth(stroke);
        const v0 = ann.points[0];
        csb.moveTo(px + v0.x / scale, py - v0.y / scale);
        for (let i = 1; i < ann.points.length; i++) {
          const v = ann.points[i];
          csb.lineTo(px + v.x / scale, py - v.y / scale);
        }
        if (ann.closed) {
          // Close path back to first vertex; stroke + close.
          csb.closeStroke();
        } else {
          csb.stroke();
        }
      });
      return;
    }
    case 'cloud': {
      // Revision-cloud: scalloped (bumpy) rectangle border. Approximate the
      // scallops with a series of short line segments bulging outward along
      // each edge — good enough for a printed markup cloud without bezier
      // support in the CSB. Falls back to a plain rect if the box is tiny.
      draw((csb) => {
        csb.setStrokeRgb(color[0], color[1], color[2]);
        csb.setLineWidth(stroke);
        const x0 = px, y0 = py - ph, x1 = px + pw, y1 = py;
        const bump = Math.max(4, (ann.scallopSize ?? 10) / scale);
        const edge = (ax: number, ay: number, bx: number, by: number) => {
          const dx = bx - ax, dy = by - ay;
          const len = Math.hypot(dx, dy) || 1;
          const n = Math.max(1, Math.round(len / (bump * 2)));
          const ux = dx / len, uy = dy / len;       // along-edge unit
          const nx = -uy, ny = ux;                  // outward normal
          let cx = ax, cy = ay;
          csb.moveTo(cx, cy);
          for (let i = 0; i < n; i++) {
            const seg = len / n;
            const mx = cx + ux * (seg / 2) + nx * bump;
            const my = cy + uy * (seg / 2) + ny * bump;
            const ex = ax + ux * seg * (i + 1);
            const ey = ay + uy * seg * (i + 1);
            csb.lineTo(mx, my);
            csb.lineTo(ex, ey);
            cx = ex; cy = ey;
          }
          csb.stroke();
        };
        // Four edges, clockwise.
        edge(x0, y1, x1, y1); // top
        edge(x1, y1, x1, y0); // right
        edge(x1, y0, x0, y0); // bottom
        edge(x0, y0, x0, y1); // left
      });
      return;
    }
    case 'check': {
      // Checkmark glyph — two strokes forming a ✓ inside the box.
      draw((csb) => {
        csb.setStrokeRgb(color[0], color[1], color[2]);
        csb.setLineWidth(Math.max(stroke, ph * 0.12));
        const bx = px, top = py, bot = py - ph;
        csb.drawLine(bx + pw * 0.15, top - ph * 0.55, bx + pw * 0.4, bot + ph * 0.18);
        csb.drawLine(bx + pw * 0.4, bot + ph * 0.18, bx + pw * 0.85, top - ph * 0.15);
      });
      return;
    }
    case 'cross': {
      // Cross / X glyph — two diagonals inside the box.
      draw((csb) => {
        csb.setStrokeRgb(color[0], color[1], color[2]);
        csb.setLineWidth(Math.max(stroke, ph * 0.12));
        const top = py, bot = py - ph;
        csb.drawLine(px + pw * 0.18, top - ph * 0.18, px + pw * 0.82, bot + ph * 0.18);
        csb.drawLine(px + pw * 0.82, top - ph * 0.18, px + pw * 0.18, bot + ph * 0.18);
      });
      return;
    }
    case 'image':
    case 'signature': {
      const img = await RmpgPdfBuilder.dataUrlToJpeg(ann.imageData);
      const name = builder.embedJpeg(pageIdx, img.bytes, img.width, img.height);
      draw((csb) => {
        csb.drawImage(name, px, py - ph, pw, ph);
      });
      return;
    }
    case 'stamp': {
      const stampColor: [number, number, number] = [0.45, 0.45, 0.45]; // Neutral gray stamp — no red splash
      const text = String(ann.label).toUpperCase();
      const fontSize = Math.max(10, ph * 0.45);
      draw((csb, useFont) => {
        const resName = useFont('HelveticaBold');
        csb.setStrokeRgb(stampColor[0], stampColor[1], stampColor[2]);
        csb.setLineWidth(2.5);
        csb.strokeRect(px, py - ph, pw, ph);
        csb.setFillRgb(stampColor[0], stampColor[1], stampColor[2]);
        // Approximate centered text: use a rough character-width estimate.
        const approxW = text.length * fontSize * 0.6;
        const tx = px + (pw - approxW) / 2;
        const ty = py - ph / 2 - fontSize / 2.6;
        csb.drawText(text, tx, ty, resName, fontSize);
      });
      return;
    }
    case 'link': {
      // Draw the visible label; the proprietary writer doesn't yet emit
      // /Annot Link dicts (TODO — covers ~30 lines of object construction).
      // Visible underlined text is the v1 fallback.
      const fontSize = Math.max(10, ph * 0.6);
      draw((csb, useFont) => {
        const resName = useFont('Helvetica');
        csb.setFillRgb(0, 0.27, 0.55);
        csb.drawText(ann.text, px + 2, py - ph + 4, resName, fontSize);
        csb.setStrokeRgb(0, 0.27, 0.55);
        csb.setLineWidth(0.6);
        csb.drawLine(px, py - ph + 2, px + pw, py - ph + 2);
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

function applyPageNumbers(builder: RmpgPdfBuilder, pageIdx: number, mediaBox: [number, number, number, number], cfg: PageNumbersConfig, n: number, total: number): void {
  const text = (cfg.format || 'Page {n} of {total}')
    .replace(/\{n\}/g, String(n))
    .replace(/\{total\}/g, String(total));
  const w = mediaBox[2] - mediaBox[0];
  const margin = 18;
  const approxW = text.length * cfg.fontSize * 0.5;
  let x = margin;
  if (cfg.position === 'bc') x = (w - approxW) / 2;
  else if (cfg.position === 'br') x = w - margin - approxW;
  const y = margin;
  builder.drawOnPage(pageIdx, (csb, useFont) => {
    const resName = useFont('Helvetica');
    csb.saveState();
    csb.setFillRgb(0.3, 0.3, 0.3);
    csb.drawText(text, x, y, resName, cfg.fontSize);
    csb.restoreState();
  });
}

async function applyWatermark(builder: RmpgPdfBuilder, pageIdx: number, mediaBox: [number, number, number, number], wm: WatermarkConfig): Promise<void> {
  const w = mediaBox[2] - mediaBox[0];
  const h = mediaBox[3] - mediaBox[1];
  const muted: [number, number, number] = [0.55, 0.55, 0.55];

  // Image watermark — draw the bitmap centered, scaled to ~40% of page width.
  if (wm.imageData) {
    try {
      const img = await RmpgPdfBuilder.dataUrlToJpeg(wm.imageData);
      const name = builder.embedJpeg(pageIdx, img.bytes, img.width, img.height);
      const targetW = w * 0.4;
      const targetH = targetW * (img.height / img.width);
      builder.drawOnPage(pageIdx, (csb) => {
        csb.saveState();
        csb.drawImage(name, (w - targetW) / 2, (h - targetH) / 2, targetW, targetH);
        csb.restoreState();
      });
    } catch { /* image embed failed — fall through to text if any */ }
    if (!wm.text.trim()) return;
  }

  // Tiled mode: repeat the text in an upright grid across the whole page.
  if (wm.mode === 'tiled' && wm.text.trim()) {
    const stepX = Math.max(120, wm.text.length * wm.fontSize * 0.6 + 60);
    const stepY = Math.max(80, wm.fontSize * 2.2);
    builder.drawOnPage(pageIdx, (csb, useFont) => {
      const resName = useFont('HelveticaBold');
      csb.saveState();
      csb.setFillRgb(muted[0], muted[1], muted[2]);
      for (let ty = stepY; ty < h; ty += stepY) {
        for (let tx = 10; tx < w; tx += stepX) {
          csb.drawText(wm.text, tx, ty, resName, wm.fontSize);
        }
      }
      csb.restoreState();
    });
    return;
  }

  if (!wm.text.trim()) return;
  // Diagonal (default): one centered, rotation-angled stamp.
  const cx = w / 2;
  const cy = h / 2;
  const rad = (wm.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  builder.drawOnPage(pageIdx, (csb, useFont) => {
    const resName = useFont('HelveticaBold');
    csb.saveState();
    const approxW = wm.text.length * wm.fontSize * 0.55;
    const tx = cx - cos * (approxW / 2) + sin * (wm.fontSize / 2);
    const ty = cy - sin * (approxW / 2) - cos * (wm.fontSize / 2);
    csb.setFillRgb(muted[0], muted[1], muted[2]);
    csb.drawText(wm.text, tx, ty, resName, wm.fontSize);
    csb.restoreState();
  });
}

/** Stamp custom header/footer text bands on a page (3 slots each band). */
function applyHeaderFooter(builder: RmpgPdfBuilder, pageIdx: number, mediaBox: [number, number, number, number], cfg: HeaderFooterConfig, n: number, total: number): void {
  const w = mediaBox[2] - mediaBox[0];
  const h = mediaBox[3] - mediaBox[1];
  const margin = 18;
  const fs = cfg.fontSize;
  const sub = (s: string | undefined) =>
    (s ?? '').replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total));
  const slots: Array<{ text: string; align: 'l' | 'c' | 'r'; y: number }> = [
    { text: sub(cfg.headerLeft), align: 'l', y: h - margin - fs },
    { text: sub(cfg.headerCenter), align: 'c', y: h - margin - fs },
    { text: sub(cfg.headerRight), align: 'r', y: h - margin - fs },
    { text: sub(cfg.footerLeft), align: 'l', y: margin },
    { text: sub(cfg.footerCenter), align: 'c', y: margin },
    { text: sub(cfg.footerRight), align: 'r', y: margin },
  ];
  builder.drawOnPage(pageIdx, (csb, useFont) => {
    const resName = useFont('Helvetica');
    csb.saveState();
    csb.setFillRgb(0.3, 0.3, 0.3);
    for (const s of slots) {
      if (!s.text) continue;
      const approxW = s.text.length * fs * 0.5;
      let x = margin;
      if (s.align === 'c') x = (w - approxW) / 2;
      else if (s.align === 'r') x = w - margin - approxW;
      csb.drawText(s.text, x, s.y, resName, fs);
    }
    csb.restoreState();
  });
}

/**
 * Apply all editor state to a fresh PDF and return its bytes.
 * Primary path: 100% RMPG PDF Engine writer.
 * Fallback path: if the proprietary writer's loader can't parse the source
 * (encrypted PDFs, cross-ref streams, exotic features), we transparently
 * fall back to pdf-lib so save/extract never fail outright on the user.
 */
export async function buildPdfFromEditorState(state: EditorState): Promise<Uint8Array> {
  if (!state.bytes) throw new Error('No source PDF loaded');

  let builder: RmpgPdfBuilder;
  try {
    builder = await RmpgPdfBuilder.load(state.bytes);
  } catch (err) {
    console.warn('[pdf-editor] proprietary writer could not load source — falling back to pdf-lib for save', err);
    return buildPdfFromEditorStateViaPdfLib(state);
  }

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
    const pageWidthPdf = pageMediaBox[2] - pageMediaBox[0];

    if (meta.crop) {
      const scale = DEFAULT_RENDER_SCALE;
      const cx = meta.crop.x / scale;
      const cw = meta.crop.w / scale;
      const ch = meta.crop.h / scale;
      const cy = pageHeightPdf - (meta.crop.y / scale) - ch;
      builder.setCropBox(visualIdx, cx, cy, cw, ch);
    }

    const ctx: PageContext = { builder, pageIdx: visualIdx, pageMeta: meta, pageHeightPdf, pageWidthPdf };
    const pageAnns = state.annotations.filter(a => a.page === visualIdx + 1);
    for (const ann of pageAnns) await drawAnnotation(ctx, ann);

    if (state.watermark && (state.watermark.text.trim() || state.watermark.imageData)) {
      await applyWatermark(builder, visualIdx, pageMediaBox, state.watermark);
    }
    if (state.bates) {
      applyBates(builder, visualIdx, pageMediaBox, state.bates, state.bates.startNumber + visualIdx);
    }
    if (state.pageNumbers) {
      applyPageNumbers(builder, visualIdx, pageMediaBox, state.pageNumbers, visualIdx + 1, state.pages.length);
    }
    if (state.headerFooter) {
      applyHeaderFooter(builder, visualIdx, pageMediaBox, state.headerFooter, visualIdx + 1, state.pages.length);
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
 * to a fresh PDF. Tries the proprietary writer first; on any failure
 * (unsupported source feature) falls back to pdf-lib so extract never
 * dead-ends on the user.
 */
export async function extractPagesAsBytes(state: EditorState, pageNumbers: number[]): Promise<Uint8Array> {
  if (!state.bytes) throw new Error('No source PDF loaded');
  const sourceIndices: number[] = [];
  for (const n of pageNumbers) {
    const visualIdx = n - 1;
    const orig = state.pageOrder[visualIdx];
    if (orig && orig > 0) sourceIndices.push(orig - 1);
  }
  if (sourceIndices.length === 0) throw new Error('No extractable pages selected');

  try {
    const builder = await RmpgPdfBuilder.load(state.bytes);
    builder.reorderPages(sourceIndices);
    builder.setMetadata({ title: `${state.meta.title ?? 'document'} (extract)` });
    return await builder.save();
  } catch (err) {
    console.warn('[pdf-editor] proprietary writer extract failed — falling back to pdf-lib', err);
    const src = await PDFDocument.load(state.bytes);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, sourceIndices);
    for (const p of copied) out.addPage(p);
    out.setProducer('RMPG PDF Engine v1.0 (pdf-lib fallback)');
    out.setTitle(`${state.meta.title ?? 'document'} (extract)`);
    return out.save();
  }
}

/**
 * POST with exponential-backoff retry for transient failures. Returns the first
 * non-retryable response (success or hard error); the caller inspects `res.ok`.
 * A thrown network error after the last attempt propagates to the caller.
 */
async function postWithRetry(
  url: string,
  init: RequestInit,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 400;
  const retriableStatus = (s: number) => s === 408 || s === 429 || (s >= 500 && s <= 599);
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || !retriableStatus(res.status) || i === attempts - 1) return res;
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) throw err;
    }
    await new Promise((r) => setTimeout(r, baseDelay * 2 ** i));
  }
  // Unreachable in practice, but satisfies the type checker.
  if (lastErr) throw lastErr;
  return fetch(url, init);
}

/**
 * Save the edited PDF directly into the Documents store via /api/uploads.
 *
 * Folder placement is sent both as `folder_id` (for forward-compat) and as the
 * canonical `entity_type=document_folder` / `entity_id` pair the Worker route
 * actually reads, so the saved file lands in the originating folder rather than
 * the unfiled root.
 */
export async function saveToDocuments(state: EditorState, opts: { folderId?: number | null; suffix?: string } = {}): Promise<{ fileId: string; original_name: string }> {
  const bytes = await buildPdfFromEditorState(state);
  const base = state.fileName.replace(/\.pdf$/i, '') || 'document';
  const newName = `${base}${opts.suffix ?? '-edited'}.pdf`;
  const file = new File([bytes as BlobPart], newName, { type: 'application/pdf' });
  const form = new FormData();
  form.append('files', file);
  const folderId = opts.folderId ?? state.sourceFolderId ?? null;
  if (folderId != null) {
    form.append('folder_id', String(folderId));
    form.append('entity_type', 'document_folder');
    form.append('entity_id', String(folderId));
  }

  const token = localStorage.getItem('rmpg_token');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Retry transient edge/network failures (network error, 408/429/5xx) with
  // exponential backoff. Auth/validation errors (4xx other than 408/429) fail
  // fast — retrying a 400 won't help. FormData can be re-sent as-is.
  const res = await postWithRetry('/api/uploads', { method: 'POST', headers, body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const files = normalizeUploadResponse(await res.json().catch(() => null));
  if (files.length === 0) throw new Error('Upload did not return file');
  return { fileId: files[0].file_id, original_name: files[0].original_name };
}

// ────────────────────────────────────────────────────────────────────────────
// pdf-lib fallback for save() — used when the proprietary writer can't parse
// the source (encrypted, cross-ref streams, exotic features). Renders the
// editor's annotations onto the source's existing pages via pdf-lib's
// drawing API, applies metadata, returns bytes.
// ────────────────────────────────────────────────────────────────────────────

async function buildPdfFromEditorStateViaPdfLib(state: EditorState): Promise<Uint8Array> {
  if (!state.bytes) throw new Error('No source PDF loaded');
  const src = await PDFDocument.load(state.bytes);
  const out = await PDFDocument.create();
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const helvBold = await out.embedFont(StandardFonts.HelveticaBold);
  const times = await out.embedFont(StandardFonts.TimesRoman);
  const courier = await out.embedFont(StandardFonts.Courier);
  const sourceIndices = state.pageOrder.filter(p => p > 0).map(i => i - 1);
  if (sourceIndices.length === 0) throw new Error('No source pages to copy');
  const copied = await out.copyPages(src, sourceIndices);

  for (let visualIdx = 0; visualIdx < copied.length; visualIdx++) {
    const page = copied[visualIdx];
    out.addPage(page);
    const meta = state.pages[visualIdx];
    if (meta?.rotation) page.setRotation(degrees((page.getRotation().angle + meta.rotation) % 360));
    if (meta?.crop) {
      const scale = DEFAULT_RENDER_SCALE;
      const pageH = page.getHeight();
      const cw = meta.crop.w / scale;
      const ch = meta.crop.h / scale;
      const cx = meta.crop.x / scale;
      const cy = pageH - (meta.crop.y / scale) - ch;
      page.setCropBox(cx, cy, cw, ch);
    }
    // Same rotation handling as the native path: draw in the displayed frame
    // (y-flip by the displayed height) under a CTM that pre-compensates for the
    // page /Rotate. ctm null for un-rotated pages → identical to before.
    const fbGeo = rotationGeometry(normRotation(meta?.rotation), page.getWidth(), page.getHeight());
    const pageH = fbGeo.dispH;
    const ann = state.annotations.filter(a => a.page === visualIdx + 1);
    if (fbGeo.ctm && ann.length) {
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(
        fbGeo.ctm[0], fbGeo.ctm[1], fbGeo.ctm[2], fbGeo.ctm[3], fbGeo.ctm[4], fbGeo.ctm[5]));
    }
    for (const a of ann) {
      const px = a.x / DEFAULT_RENDER_SCALE;
      const pw = a.w / DEFAULT_RENDER_SCALE;
      const ph = a.h / DEFAULT_RENDER_SCALE;
      const py = pageH - (a.y / DEFAULT_RENDER_SCALE);
      const c = hexToRgb(a.color);
      if (a.type === 'text') {
        const fbFont = a.fontFamily === 'times' ? times : a.fontFamily === 'courier' ? courier : (a.bold ? helvBold : helv);
        page.drawText(a.text, { x: px, y: py - a.fontSize, size: a.fontSize, font: fbFont, color: rgb(c[0], c[1], c[2]) });
      } else if (a.type === 'highlight') {
        page.drawRectangle({ x: px, y: py - ph, width: pw, height: ph, color: rgb(0.6, 0.6, 0.6), opacity: 0.3 });
      } else if (a.type === 'underline' || a.type === 'strikethrough') {
        const th = Math.max(0.5, a.strokeWidth ?? 1.5);
        const ruleY = a.type === 'underline' ? py - ph : py - ph / 2 - th / 2;
        page.drawRectangle({ x: px, y: ruleY, width: pw, height: th, color: rgb(c[0], c[1], c[2]) });
      } else if (a.type === 'redact') {
        page.drawRectangle({ x: px, y: py - ph, width: pw, height: ph, color: rgb(0, 0, 0) });
      } else if (a.type === 'rect') {
        page.drawRectangle({ x: px, y: py - ph, width: pw, height: ph, borderColor: rgb(c[0], c[1], c[2]), borderWidth: a.strokeWidth ?? 1.5 });
      } else if (a.type === 'line') {
        page.drawLine({ start: { x: px, y: py }, end: { x: px + pw, y: py - ph }, thickness: a.strokeWidth ?? 1.5, color: rgb(c[0], c[1], c[2]) });
      } else if (a.type === 'check') {
        const lw = Math.max(a.strokeWidth ?? 1.5, ph * 0.12);
        const top = py, bot = py - ph;
        page.drawLine({ start: { x: px + pw * 0.15, y: top - ph * 0.55 }, end: { x: px + pw * 0.4, y: bot + ph * 0.18 }, thickness: lw, color: rgb(c[0], c[1], c[2]) });
        page.drawLine({ start: { x: px + pw * 0.4, y: bot + ph * 0.18 }, end: { x: px + pw * 0.85, y: top - ph * 0.15 }, thickness: lw, color: rgb(c[0], c[1], c[2]) });
      } else if (a.type === 'cross') {
        const lw = Math.max(a.strokeWidth ?? 1.5, ph * 0.12);
        const top = py, bot = py - ph;
        page.drawLine({ start: { x: px + pw * 0.18, y: top - ph * 0.18 }, end: { x: px + pw * 0.82, y: bot + ph * 0.18 }, thickness: lw, color: rgb(c[0], c[1], c[2]) });
        page.drawLine({ start: { x: px + pw * 0.82, y: top - ph * 0.18 }, end: { x: px + pw * 0.18, y: bot + ph * 0.18 }, thickness: lw, color: rgb(c[0], c[1], c[2]) });
      } else if (a.type === 'cloud') {
        page.drawRectangle({ x: px, y: py - ph, width: pw, height: ph, borderColor: rgb(c[0], c[1], c[2]), borderWidth: a.strokeWidth ?? 1.5 });
      } else if (a.type === 'image' || a.type === 'signature') {
        try {
          const isPng = a.imageData.startsWith('data:image/png');
          const bytes = Uint8Array.from(atob(a.imageData.split(',')[1]), x => x.charCodeAt(0));
          const img = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
          page.drawImage(img, { x: px, y: py - ph, width: pw, height: ph });
        } catch (err) { console.warn('[fallback] image embed failed', err); }
      }
    }
    if (fbGeo.ctm && ann.length) page.pushOperators(popGraphicsState());
    if (state.pageNumbers) {
      const cfg = state.pageNumbers;
      const text = (cfg.format || 'Page {n} of {total}')
        .replace(/\{n\}/g, String(visualIdx + 1))
        .replace(/\{total\}/g, String(copied.length));
      const pw2 = page.getWidth();
      const approxW = text.length * cfg.fontSize * 0.5;
      let nx = 18;
      if (cfg.position === 'bc') nx = (pw2 - approxW) / 2;
      else if (cfg.position === 'br') nx = pw2 - 18 - approxW;
      page.drawText(text, { x: nx, y: 18, size: cfg.fontSize, font: helv, color: rgb(0.3, 0.3, 0.3) });
    }
    if (state.headerFooter) {
      const hf = state.headerFooter;
      const pw2 = page.getWidth();
      const ph2 = page.getHeight();
      const margin = 18;
      const fs = hf.fontSize;
      const sub = (s: string | undefined) => (s ?? '')
        .replace(/\{n\}/g, String(visualIdx + 1)).replace(/\{total\}/g, String(copied.length));
      const slots: Array<{ text: string; align: 'l' | 'c' | 'r'; y: number }> = [
        { text: sub(hf.headerLeft), align: 'l', y: ph2 - margin - fs },
        { text: sub(hf.headerCenter), align: 'c', y: ph2 - margin - fs },
        { text: sub(hf.headerRight), align: 'r', y: ph2 - margin - fs },
        { text: sub(hf.footerLeft), align: 'l', y: margin },
        { text: sub(hf.footerCenter), align: 'c', y: margin },
        { text: sub(hf.footerRight), align: 'r', y: margin },
      ];
      for (const s of slots) {
        if (!s.text) continue;
        const approxW = s.text.length * fs * 0.5;
        let x = margin;
        if (s.align === 'c') x = (pw2 - approxW) / 2;
        else if (s.align === 'r') x = pw2 - margin - approxW;
        page.drawText(s.text, { x, y: s.y, size: fs, font: helv, color: rgb(0.3, 0.3, 0.3) });
      }
    }
  }
  if (state.meta.title) out.setTitle(state.meta.title);
  if (state.meta.author) out.setAuthor(state.meta.author);
  out.setProducer('RMPG PDF Engine v1.0 (pdf-lib fallback)');
  out.setModificationDate(new Date());
  return out.save();
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

/**
 * Append the pages of `extra` (raw PDF bytes) to `base`, returning a fresh
 * combined byte buffer. The editor re-opens the result so all downstream
 * page/annotation state is rebuilt cleanly — annotations on the base document
 * are flattened into the bytes first by the caller when needed.
 */
export async function appendPdfBytes(base: Uint8Array, extra: Uint8Array): Promise<Uint8Array> {
  const out = await PDFDocument.load(base);
  const src = await PDFDocument.load(extra);
  const copied = await out.copyPages(src, src.getPageIndices());
  for (const p of copied) out.addPage(p);
  out.setProducer('RMPG PDF Engine v1.0 — append via pdf-lib');
  out.setModificationDate(new Date());
  return out.save();
}

/**
 * Build a single-page PDF whose page IS the given image, sized to US Letter
 * with the image scaled to fit (preserving aspect ratio, centered). Returns
 * bytes; the caller appends or opens them.
 */
export async function imageToPdfPageBytes(dataUrl: string): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const comma = dataUrl.indexOf(',');
  const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), c => c.charCodeAt(0));
  const isPng = /^data:image\/png/i.test(dataUrl);
  const img = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
  // US Letter portrait.
  const PW = 612, PH = 792, margin = 36;
  const page = out.addPage([PW, PH]);
  const availW = PW - margin * 2, availH = PH - margin * 2;
  const scale = Math.min(availW / img.width, availH / img.height, 1);
  const w = img.width * scale, h = img.height * scale;
  page.drawImage(img, { x: (PW - w) / 2, y: (PH - h) / 2, width: w, height: h });
  out.setProducer('RMPG PDF Engine v1.0 — image page');
  return out.save();
}

/**
 * Build a single blank page (US Letter) with an optional lined or grid
 * background drawn into the content stream. Returns bytes.
 */
export async function blankTemplatePageBytes(template: 'blank' | 'lined' | 'grid'): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const PW = 612, PH = 792;
  const page = out.addPage([PW, PH]);
  const line = rgb(0.78, 0.78, 0.82);
  if (template === 'lined') {
    const margin = 48;
    for (let y = margin; y < PH - margin; y += 28) {
      page.drawLine({ start: { x: margin, y }, end: { x: PW - margin, y }, thickness: 0.5, color: line });
    }
  } else if (template === 'grid') {
    const step = 24;
    for (let x = step; x < PW; x += step) page.drawLine({ start: { x, y: 0 }, end: { x, y: PH }, thickness: 0.4, color: line });
    for (let y = step; y < PH; y += step) page.drawLine({ start: { x: 0, y }, end: { x: PW, y }, thickness: 0.4, color: line });
  }
  out.setProducer('RMPG PDF Engine v1.0 — blank template');
  return out.save();
}

/**
 * Extract all selectable text from a PDF, page by page, via the engine's
 * pdfjs text layer. Returns a plain-text string with page separators.
 */
export async function extractAllText(bytes: Uint8Array): Promise<string> {
  const pdf = await openEnginePdf(bytes, { backend: 'pdfjs' });
  try {
    const out: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const items = await page.getTextContent();
      out.push(`──── Page ${i} ────`);
      out.push(items.map(it => it.str).join(' ').replace(/\s+\n/g, '\n').trim());
      out.push('');
    }
    return out.join('\n');
  } finally {
    await pdf.destroy().catch(() => { /* already gone */ });
  }
}

/**
 * Find regex matches in the document's text and return redaction rectangles
 * (in editor screen-pixel space at DEFAULT_RENDER_SCALE) for each match. Used
 * by the search-and-redact dialog. Page is 1-indexed visual order.
 */
export interface RedactBox { page: number; x: number; y: number; w: number; h: number; text: string; }
export async function findRedactionBoxes(
  bytes: Uint8Array,
  pageOrder: number[],
  regex: RegExp,
): Promise<RedactBox[]> {
  const pdf = await openEnginePdf(bytes, { backend: 'pdfjs' });
  const scale = DEFAULT_RENDER_SCALE;
  const boxes: RedactBox[] = [];
  try {
    for (let visualIdx = 0; visualIdx < pageOrder.length; visualIdx++) {
      const original = pageOrder[visualIdx];
      if (!original || original <= 0) continue; // inserted blank
      const page = await pdf.getPage(original);
      const vp = page.getViewport({ scale: 1 });
      const pageH = vp.height;
      const items = await page.getTextContent();
      for (const it of items) {
        if (!it.str) continue;
        regex.lastIndex = 0;
        if (!regex.test(it.str)) continue;
        // transform = [a,b,c,d,e,f]; e,f is the text origin (baseline, bottom-up).
        const [, , , , e, f] = it.transform;
        const wPts = it.width || it.str.length * (it.height || 8) * 0.5;
        const hPts = it.height || 10;
        // Convert PDF user-space (bottom-up) → screen px (top-down) at scale.
        const sx = e * scale;
        const sy = (pageH - f - hPts) * scale;
        boxes.push({
          page: visualIdx + 1,
          x: sx,
          y: sy,
          w: wPts * scale,
          h: hPts * scale * 1.25,
          text: it.str,
        });
      }
    }
    return boxes;
  } finally {
    await pdf.destroy().catch(() => { /* already gone */ });
  }
}
