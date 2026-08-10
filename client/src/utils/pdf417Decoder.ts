// ============================================================
// RMPG Flex — PDF417 barcode decoder (driver's-license back)
// ============================================================
// Decodes the PDF417 stacked barcode from a photo of the back of
// an ID card using zxing-wasm (the full C++ ZXing core compiled
// to WebAssembly — far stronger PDF417 support than the JS port,
// which fails even on clean synthetic barcodes).
//
// The .wasm binary is bundled by Vite (`?url` import) and served
// same-origin — the package's default CDN locateFile would violate
// our `connect-src 'self'` CSP and break offline/MDT use.
// ============================================================

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
// Vite emits the wasm as a hashed asset and gives us its URL.
// eslint-disable-next-line import/no-unresolved
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

let prepared = false;
let moduleError: string | null = null;

function ensureModule(): void {
  if (prepared) return;
  prepared = true;
  try {
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? wasmUrl : prefix + path,
      },
    });
  } catch (err) {
    moduleError = (err as Error)?.message ?? String(err);
    console.error('[pdf417] WASM module init failed:', err);
  }
}

/** Returns the WASM init error message, or null if init succeeded. */
export function getModuleError(): string | null {
  ensureModule();
  return moduleError;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image file')); };
    img.src = url;
  });
}

type ContrastMode = 'none' | 'linear' | 'minmax' | 'binarize' | 'sharpen' | 'adaptive';

function toImageData(img: HTMLImageElement, scale: number, mode: ContrastMode): ImageData {
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  if (mode === 'none') return data;

  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    lum[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }

  if (mode === 'sharpen') {
    // Unsharp-mask: sharpens module edges that phone blur smears.
    const blurred = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
              sum += lum[ny * w + nx]; count++;
            }
          }
        }
        blurred[y * w + x] = sum / count;
      }
    }
    const amount = 1.5;
    for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
      const v = Math.min(255, Math.max(0, Math.round(lum[p] + amount * (lum[p] - blurred[p]))));
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  } else if (mode === 'linear') {
    for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
      const v = Math.min(255, Math.max(0, (lum[p] - 128) * 1.8 + 128));
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  } else if (mode === 'minmax') {
    let lo = 255, hi = 0;
    for (let p = 0; p < lum.length; p++) { if (lum[p] < lo) lo = lum[p]; if (lum[p] > hi) hi = lum[p]; }
    const range = hi - lo || 1;
    for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
      const v = Math.round(((lum[p] - lo) / range) * 255);
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  } else if (mode === 'binarize') {
    const hist = new Int32Array(256);
    for (let p = 0; p < lum.length; p++) hist[Math.round(lum[p])]++;
    const total = lum.length;
    let sumAll = 0;
    for (let t = 0; t < 256; t++) sumAll += t * hist[t];
    let sumB = 0, wB = 0, best = 0, threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sumAll - sumB) / wF;
      const bcv = wB * wF * (mB - mF) ** 2;
      if (bcv > best) { best = bcv; threshold = t; }
    }
    for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
      const v = lum[p] >= threshold ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  } else if (mode === 'adaptive') {
    // Adaptive threshold with integral image — handles local shadows
    // across the card surface from doorstep lighting.
    const blockSize = Math.max(15, Math.round(Math.min(w, h) / 20) | 1);
    const half = blockSize >> 1;
    const integral = new Float64Array((w + 1) * (h + 1));
    const sw = w + 1;
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        rowSum += lum[y * w + x];
        integral[(y + 1) * sw + (x + 1)] = rowSum + integral[y * sw + (x + 1)];
      }
    }
    const bias = -8;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const y0 = Math.max(0, y - half), y1 = Math.min(h - 1, y + half);
        const x0 = Math.max(0, x - half), x1 = Math.min(w - 1, x + half);
        const area = (y1 - y0 + 1) * (x1 - x0 + 1);
        const sum = integral[(y1 + 1) * sw + (x1 + 1)]
          - integral[y0 * sw + (x1 + 1)]
          - integral[(y1 + 1) * sw + x0]
          + integral[y0 * sw + x0];
        const mean = sum / area;
        const i = (y * w + x) * 4;
        const v = lum[y * w + x] < mean + bias ? 0 : 255;
        px[i] = px[i + 1] = px[i + 2] = v;
      }
    }
  }

  return data;
}

/**
 * Fast single-pass decode for live camera frames. No preprocessing —
 * called many times per second, so each attempt must be cheap; the
 * camera supplies fresh framing/focus variation between attempts.
 */
export async function decodePdf417Frame(imageData: ImageData): Promise<string | null> {
  ensureModule();
  try {
    const results = await readBarcodes(imageData, {
      formats: ['PDF417'],
      tryHarder: false,
      tryRotate: true,
      tryInvert: true,
      tryDownscale: true,
      textMode: 'Plain',
      maxNumberOfSymbols: 1,
    });
    const r = results[0];
    if (!r?.isValid) return null;
    // AAMVA uses Latin-1 encoded bytes with raw control chars (\x1e, \r).
    // Decode from r.bytes rather than r.text to preserve every byte exactly.
    const raw = new TextDecoder('latin1').decode(r.bytes);
    return raw.length > 20 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Fast single-pass QR decode for live camera frames — used by the officer
 * wallet-ID verify scanner (src/pages/wallet/VerifyIdPage.tsx). Reuses the same
 * one-time zxing module init as the PDF417 path so the wasm is prepared once.
 */
export async function decodeQrFrame(imageData: ImageData): Promise<string | null> {
  ensureModule();
  try {
    const results = await readBarcodes(imageData, {
      formats: ['QRCode'],
      tryHarder: false,
      tryRotate: true,
      tryInvert: true,
      tryDownscale: true,
      textMode: 'Plain',
      maxNumberOfSymbols: 1,
    });
    return results[0]?.text || null;
  } catch {
    return null;
  }
}

export interface Pdf417DecodeOutcome {
  text: string;
  passes: number; // how many attempts it took (diagnostics)
}

/**
 * Decode a PDF417 barcode from an uploaded/captured photo.
 * Returns null if no barcode could be found after all passes.
 *
 * ZXing already tries rotations, inversion and downscaling
 * internally (tryRotate/tryInvert/tryDownscale); our outer passes
 * vary what it can't — working resolution and contrast — to cope
 * with blurry or washed-out phone photos.
 */
export async function decodePdf417(file: File): Promise<Pdf417DecodeOutcome | null> {
  ensureModule();
  const img = await loadImage(file);

  const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
  if (!maxDim) return null;

  // Full native resolution first — modern phones (4032x3024) need every
  // pixel to resolve the fine module grid on a PDF417 barcode. Only cap
  // at 4800px for extremely high-res sensors to bound WASM memory.
  const baseScale = maxDim > 4800 ? 4800 / maxDim : 1;
  const scales: number[] = [
    baseScale,
    Math.min(baseScale * 1.5, 1.0),
    baseScale * 0.75,
    baseScale * 0.5,
  ].filter((s, i, a) => a.indexOf(s) === i);

  const modes: ContrastMode[] = ['none', 'sharpen', 'linear', 'adaptive', 'minmax', 'binarize'];

  let passes = 0;
  for (const mode of modes) {
    for (const scale of scales) {
      passes++;
      try {
        const results = await readBarcodes(toImageData(img, scale, mode), {
          formats: ['PDF417'],
          tryHarder: true,
          tryRotate: true,
          tryInvert: true,
          tryDownscale: true,
          textMode: 'Plain',
          maxNumberOfSymbols: 1,
        });
        const r = results[0];
        if (!r?.isValid) continue;
        const text = new TextDecoder('latin1').decode(r.bytes);
        if (text.length > 20) return { text, passes };
      } catch {
        // decode error on this pass — try the next configuration
      }
    }
  }
  return null;
}
