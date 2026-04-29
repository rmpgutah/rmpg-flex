import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import { Annotation, BatesConfig, DocumentMeta, EditorState, PageMeta, WatermarkConfig, DEFAULT_RENDER_SCALE } from './types';

// Save pipeline.
//
// Given the editor state (original PDF bytes + page order + annotations + bates +
// watermark + metadata), produce a new PDF byte stream. The caller owns the
// resulting Blob/download lifecycle.
//
// Coordinate conversion happens here and only here. Annotations live in screen
// pixels at DEFAULT_RENDER_SCALE; pdf-lib draws in PDF user-space (origin
// bottom-left, in points).

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

interface DrawCtx {
  doc: PDFDocument;
  page: PDFPage;
  pageMeta: PageMeta;
  helv: PDFFont;
  helvBold: PDFFont;
  helvItalic: PDFFont;
}

function drawAnnotation(ctx: DrawCtx, ann: Annotation): Promise<void> | void {
  const { page, pageMeta, helv, helvBold, helvItalic, doc } = ctx;
  const scale = DEFAULT_RENDER_SCALE;
  const pageH = page.getHeight();
  // Convert screen (top-left) → PDF user-space (bottom-left).
  const px = ann.x / scale;
  const py = pageH - (ann.y / scale);
  const pw = ann.w / scale;
  const ph = ann.h / scale;
  const stroke = (ann.strokeWidth ?? 1.5);
  const opacity = ann.opacity ?? 1;
  const colorRgb = rgb(...hexToRgb(ann.color, [0, 0, 0]));
  const fillRgb = rgb(...hexToRgb(ann.fillColor ?? ann.color, [0, 0, 0]));

  switch (ann.type) {
    case 'text': {
      const font = ann.bold ? helvBold : ann.italic ? helvItalic : helv;
      const size = ann.fontSize;
      page.drawText(ann.text, {
        x: px,
        y: py - size,
        size,
        font,
        color: colorRgb,
        opacity,
      });
      return;
    }
    case 'highlight': {
      page.drawRectangle({
        x: px, y: py - ph, width: pw, height: ph,
        color: rgb(...hexToRgb(ann.fillColor ?? '#fff050', [1, 0.94, 0.31])),
        opacity: opacity * 0.4,
      });
      return;
    }
    case 'redact': {
      // Visual-flatten redaction. Hard caveat: this paints over content but the
      // underlying text stream is preserved by pdf-lib. UI warns the user.
      page.drawRectangle({
        x: px, y: py - ph, width: pw, height: ph,
        color: rgb(0, 0, 0),
        opacity: 1,
      });
      return;
    }
    case 'rect': {
      page.drawRectangle({
        x: px, y: py - ph, width: pw, height: ph,
        borderColor: colorRgb,
        borderWidth: stroke,
        color: ann.fillColor ? fillRgb : undefined,
        opacity,
      });
      return;
    }
    case 'ellipse': {
      page.drawEllipse({
        x: px + pw / 2,
        y: py - ph / 2,
        xScale: pw / 2,
        yScale: ph / 2,
        borderColor: colorRgb,
        borderWidth: stroke,
        color: ann.fillColor ? fillRgb : undefined,
        opacity,
      });
      return;
    }
    case 'line': {
      const startX = px;
      const startY = py;
      const endX = px + pw;
      const endY = py - ph;
      page.drawLine({
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        thickness: stroke,
        color: colorRgb,
        opacity,
      });
      if (ann.arrow) {
        // Draw a short arrowhead at the end.
        const dx = endX - startX;
        const dy = endY - startY;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const headLen = 12;
        const headW = 6;
        // Back along the line and perpendicular offsets.
        const bx = endX - ux * headLen;
        const by = endY - uy * headLen;
        const px1 = bx + (-uy) * headW;
        const py1 = by + (ux) * headW;
        const px2 = bx - (-uy) * headW;
        const py2 = by - (ux) * headW;
        page.drawLine({ start: { x: endX, y: endY }, end: { x: px1, y: py1 }, thickness: stroke, color: colorRgb });
        page.drawLine({ start: { x: endX, y: endY }, end: { x: px2, y: py2 }, thickness: stroke, color: colorRgb });
      }
      return;
    }
    case 'pen': {
      if (ann.points.length < 2) return;
      for (let i = 1; i < ann.points.length; i++) {
        const a = ann.points[i - 1];
        const b = ann.points[i];
        page.drawLine({
          start: { x: px + a.x / scale, y: py - a.y / scale },
          end: { x: px + b.x / scale, y: py - b.y / scale },
          thickness: stroke,
          color: colorRgb,
          opacity,
        });
      }
      return;
    }
    case 'image':
    case 'signature': {
      return (async () => {
        const isPng = ann.imageData.startsWith('data:image/png');
        const bytes = Uint8Array.from(atob(ann.imageData.split(',')[1]), c => c.charCodeAt(0));
        const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        page.drawImage(img, {
          x: px, y: py - ph, width: pw, height: ph, opacity,
        });
      })();
    }
    case 'stamp': {
      // Render a labeled red ribbon-style stamp: rectangle border + centered text.
      const stampColor = rgb(0.78, 0.1, 0.12);
      page.drawRectangle({
        x: px, y: py - ph, width: pw, height: ph,
        borderColor: stampColor,
        borderWidth: 2.5,
        opacity: opacity * 0.85,
      });
      const text = String(ann.label).toUpperCase();
      const fontSize = Math.max(10, ph * 0.45);
      const textWidth = helvBold.widthOfTextAtSize(text, fontSize);
      page.drawText(text, {
        x: px + (pw - textWidth) / 2,
        y: py - ph / 2 - fontSize / 2.6,
        size: fontSize,
        font: helvBold,
        color: stampColor,
        opacity: opacity * 0.85,
      });
      return;
    }
  }
}

function applyBates(page: PDFPage, helv: PDFFont, cfg: BatesConfig, n: number) {
  const text = makeBatesText(cfg, n);
  const w = page.getWidth();
  const h = page.getHeight();
  const margin = 18;
  const tw = helv.widthOfTextAtSize(text, cfg.fontSize);
  let x = margin;
  let y = margin;
  if (cfg.position === 'tl') { x = margin; y = h - margin - cfg.fontSize; }
  else if (cfg.position === 'tr') { x = w - margin - tw; y = h - margin - cfg.fontSize; }
  else if (cfg.position === 'bl') { x = margin; y = margin; }
  else { x = w - margin - tw; y = margin; }
  page.drawText(text, { x, y, size: cfg.fontSize, font: helv, color: rgb(0.3, 0.3, 0.3) });
}

function applyWatermark(page: PDFPage, helvBold: PDFFont, wm: WatermarkConfig) {
  const w = page.getWidth();
  const h = page.getHeight();
  const tw = helvBold.widthOfTextAtSize(wm.text, wm.fontSize);
  page.drawText(wm.text, {
    x: w / 2 - tw / 2,
    y: h / 2 - wm.fontSize / 2,
    size: wm.fontSize,
    font: helvBold,
    color: rgb(0.55, 0.55, 0.55),
    opacity: wm.opacity,
    rotate: degrees(wm.rotation),
  });
}

function setMetadata(doc: PDFDocument, meta: DocumentMeta) {
  if (meta.title) doc.setTitle(meta.title);
  if (meta.author) doc.setAuthor(meta.author);
  if (meta.subject) doc.setSubject(meta.subject);
  if (meta.keywords) doc.setKeywords(meta.keywords.split(',').map(k => k.trim()).filter(Boolean));
  doc.setProducer('RMPG Flex PDF Editor');
  doc.setModificationDate(new Date());
}

/**
 * Apply all editor state to a fresh PDF and return its bytes.
 */
export async function buildPdfFromEditorState(state: EditorState): Promise<Uint8Array> {
  if (!state.bytes) throw new Error('No source PDF loaded');

  const src = await PDFDocument.load(state.bytes.slice());
  const out = await PDFDocument.create();
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const helvBold = await out.embedFont(StandardFonts.HelveticaBold);
  const helvItalic = await out.embedFont(StandardFonts.HelveticaOblique);

  // Copy pages in the user-defined visual order.
  const sourceIndices = state.pageOrder.map(i => i - 1);
  const copied = await out.copyPages(src, sourceIndices);

  for (let visualIdx = 0; visualIdx < copied.length; visualIdx++) {
    const page = copied[visualIdx];
    out.addPage(page);

    const pageMeta = state.pages[visualIdx];
    if (!pageMeta) continue;

    // Apply rotation.
    if (pageMeta.rotation) {
      page.setRotation(degrees((page.getRotation().angle + pageMeta.rotation) % 360));
    }

    // Annotations whose page === visualIdx + 1.
    const pageAnns = state.annotations.filter(a => a.page === visualIdx + 1);
    for (const ann of pageAnns) {
      const result = drawAnnotation({ doc: out, page, pageMeta, helv, helvBold, helvItalic }, ann);
      if (result instanceof Promise) await result;
    }

    if (state.watermark && state.watermark.text.trim()) {
      applyWatermark(page, helvBold, state.watermark);
    }
    if (state.bates) {
      applyBates(page, helv, state.bates, state.bates.startNumber + visualIdx);
    }
  }

  setMetadata(out, state.meta);

  // Disabling object streams keeps the painted overlays as visible content
  // operators rather than referenced annotation objects — the closest pdf-lib
  // gets to a "flatten" save for redaction durability.
  return out.save({ useObjectStreams: false });
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

export async function mergePdfFiles(files: File[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const file of files) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const src = await PDFDocument.load(buf);
    const idxs = src.getPageIndices();
    const copied = await merged.copyPages(src, idxs);
    for (const p of copied) merged.addPage(p);
  }
  merged.setProducer('RMPG Flex PDF Editor');
  merged.setCreationDate(new Date());
  return merged.save();
}
