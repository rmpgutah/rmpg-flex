// ============================================================
// RMPG Flex — ALPR image dynamics (OCR pre-processing)
// ============================================================
// Plates read far better after a little image conditioning. Before a capture
// is sent to OCR we: optionally crop to the region of interest, upscale so the
// plate has more pixels, apply a percentile contrast-stretch (recover detail
// from dark/washed frames), and an unsharp mask (crisp the glyph edges). The
// statistical core (histogram / percentile bounds / contrast LUT) is pure and
// unit-tested; the canvas pass uses it.
// ============================================================

/** 256-bin luminance histogram from an RGBA buffer. */
export function luminanceHistogram(rgba: Uint8ClampedArray): number[] {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < rgba.length; i += 4) {
    const y = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114 + 0.5) | 0;
    hist[y < 0 ? 0 : y > 255 ? 255 : y]++;
  }
  return hist;
}

/** Low/high luminance bounds at the given cumulative percentiles (robust to
 *  outliers). Returns [lo, hi] with hi > lo guaranteed. */
export function percentileBounds(hist: number[], lowPct = 0.02, highPct = 0.98): [number, number] {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return [0, 255];
  const loTarget = total * lowPct, hiTarget = total * highPct;
  let cum = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum >= loTarget) { lo = v; break; } }
  cum = 0;
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum >= hiTarget) { hi = v; break; } }
  if (hi <= lo) hi = Math.min(255, lo + 1);
  return [lo, hi];
}

/** A 256→256 LUT that linearly stretches [lo,hi] to [0,255]. */
export function contrastLUT(lo: number, hi: number): Uint8Array {
  const lut = new Uint8Array(256);
  const span = Math.max(1, hi - lo);
  for (let v = 0; v < 256; v++) {
    const out = ((v - lo) / span) * 255;
    lut[v] = out < 0 ? 0 : out > 255 ? 255 : out | 0;
  }
  return lut;
}

/** Unsharp-mask a single channel value: orig + amount*(orig - blurred). */
export function unsharpValue(orig: number, blurred: number, amount: number): number {
  const v = orig + amount * (orig - blurred);
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

export interface EnhanceOpts {
  crop?: { x: number; y: number; w: number; h: number } | null; // fractional ROI (0..1)
  targetWidth?: number;     // upscale so the (cropped) width ≥ this (default 1280)
  maxWidth?: number;        // never exceed (default 1600)
  contrast?: boolean;       // percentile contrast stretch (default true)
  sharpen?: number;         // unsharp amount, 0 = off (default 0.8)
  quality?: number;         // jpeg quality (default 0.92)
}

/** Load a Blob/File into an ImageBitmap (or <img> fallback). */
async function toBitmap(src: Blob): Promise<{ w: number; h: number; draw: (ctx: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number, sx: number, sy: number, sw: number, sh: number) => void }> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(src);
    return { w: bmp.width, h: bmp.height, draw: (ctx, dx, dy, dw, dh, sx, sy, sw, sh) => ctx.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh) };
  }
  const url = URL.createObjectURL(src);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    return { w: img.naturalWidth, h: img.naturalHeight, draw: (ctx, dx, dy, dw, dh, sx, sy, sw, sh) => ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) };
  } finally { /* keep url alive until draw; revoke after */ setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

/** Enhance a capture for OCR: crop → upscale → contrast-stretch → unsharp.
 *  Falls back to the original blob on any canvas failure (never throws). */
export async function enhancePlateImage(src: Blob, opts: EnhanceOpts = {}): Promise<Blob> {
  const { crop = null, targetWidth = 1280, maxWidth = 1600, contrast = true, sharpen = 0.8, quality = 0.92 } = opts;
  try {
    const bmp = await toBitmap(src);
    const sx = crop ? Math.round(crop.x * bmp.w) : 0;
    const sy = crop ? Math.round(crop.y * bmp.h) : 0;
    const sw = crop ? Math.max(1, Math.round(crop.w * bmp.w)) : bmp.w;
    const sh = crop ? Math.max(1, Math.round(crop.h * bmp.h)) : bmp.h;
    const scale = Math.min(maxWidth / sw, Math.max(1, targetWidth / sw));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement('canvas');
    canvas.width = dw; canvas.height = dh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return src;
    (ctx as any).imageSmoothingQuality = 'high';
    bmp.draw(ctx, 0, 0, dw, dh, sx, sy, sw, sh);

    const img = ctx.getImageData(0, 0, dw, dh);
    const px = img.data;

    if (contrast) {
      const [lo, hi] = percentileBounds(luminanceHistogram(px));
      const lut = contrastLUT(lo, hi);
      for (let i = 0; i < px.length; i += 4) { px[i] = lut[px[i]]; px[i + 1] = lut[px[i + 1]]; px[i + 2] = lut[px[i + 2]]; }
    }

    if (sharpen > 0) {
      // 3×3 box-blur reference, then unsharp each channel (skip 1px border).
      const src2 = new Uint8ClampedArray(px);
      const W = dw;
      for (let y = 1; y < dh - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const o = (y * W + x) * 4;
          for (let c = 0; c < 3; c++) {
            let sum = 0;
            for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) sum += src2[((y + ky) * W + (x + kx)) * 4 + c];
            px[o + c] = unsharpValue(src2[o + c], sum / 9, sharpen);
          }
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    return blob || src;
  } catch {
    return src;   // never block a capture on enhancement
  }
}
