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
//
// `prepareZXingModule` MUST be awaited before the first `readBarcodes`.
// If the locateFile override is not in place yet, zxing-wasm fetches
// from jsDelivr, which CSP blocks, and every ID scan fails.
// ============================================================

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
// Vite emits the wasm as a hashed asset and gives us its URL.
// eslint-disable-next-line import/no-unresolved
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import {
  extractZxingText,
  cropImageData,
  LIVE_PDF417_CROP,
} from './pdf417Payload';

let prepared: Promise<void> | null = null;
let moduleError: string | null = null;

async function ensureModule(): Promise<void> {
  if (!prepared) {
    prepared = (async () => {
      try {
        await prepareZXingModule({
          overrides: {
            locateFile: (path: string, prefix: string) =>
              path.endsWith('.wasm') ? wasmUrl : prefix + path,
          },
        });
      } catch (err) {
        moduleError = (err as Error)?.message ?? String(err);
        console.error('[pdf417] WASM module init failed:', err);
        throw err;
      }
    })();
  }
  await prepared;
}

/** Returns the WASM init error message, or null if init succeeded. */
export async function getModuleError(): Promise<string | null> {
  try {
    await ensureModule();
  } catch {
    /* moduleError already set */
  }
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

type ContrastMode = 'sharpen' | 'linear' | 'adaptive' | 'minmax' | 'binarize';

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

  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    lum[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }

  if (mode === 'sharpen') {
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

type ZxingBinarizer = 'LocalAverage' | 'GlobalHistogram' | 'FixedThreshold' | 'BoolCast';

async function tryNativeDecode(
  input: Blob | ImageData,
  binarizer: ZxingBinarizer,
  tryDenoise: boolean,
  tryHarder: boolean,
): Promise<string | null> {
  try {
    const results = await readBarcodes(input, {
      formats: ['PDF417'],
      tryHarder,
      tryRotate: true,
      tryInvert: true,
      tryDownscale: true,
      tryDenoise,
      binarizer,
      textMode: 'Plain',
      maxNumberOfSymbols: 1,
    });
    return extractZxingText(results[0] as { isValid?: boolean; bytes?: Uint8Array; text?: string });
  } catch {
    return null;
  }
}

/**
 * Chromium's BarcodeDetector can read PDF417 natively (Safari cannot).
 * Try it first so we don't pay the WASM cost on Android Chrome when the
 * platform decoder already has the payload.
 */
type BarcodeDetectorCtor = {
  new (opts: { formats: string[] }): { detect: (s: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> };
  getSupportedFormats?: () => Promise<string[]>;
};

async function tryBarcodeDetector(source: ImageBitmapSource): Promise<string | null> {
  const BD = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!BD) return null;
  try {
    if (typeof BD.getSupportedFormats === 'function') {
      const formats = await BD.getSupportedFormats();
      if (!formats.map((f) => f.toLowerCase()).includes('pdf417')) return null;
    }
    const detector = new BD({ formats: ['pdf417'] });
    const codes = await detector.detect(source);
    const raw = codes[0]?.rawValue;
    return raw && raw.length >= 20 ? raw : null;
  } catch {
    return null;
  }
}

function downscaleIfNeeded(imageData: ImageData, maxWidth: number): ImageData {
  if (imageData.width <= maxWidth) return imageData;
  const scale = maxWidth / imageData.width;
  const w = Math.max(1, Math.round(imageData.width * scale));
  const h = Math.max(1, Math.round(imageData.height * scale));
  const src = document.createElement('canvas');
  src.width = imageData.width;
  src.height = imageData.height;
  src.getContext('2d')!.putImageData(imageData, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = w;
  dst.height = h;
  const ctx = dst.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Fast-ish live-camera decode. Crops to the ID-back barcode strip and
 * runs tryHarder on the ROI — a full 1080p frame with tryHarder:false
 * is the combination that never hits on a real Utah DL in the field.
 */
export async function decodePdf417Frame(imageData: ImageData): Promise<string | null> {
  const native = await tryBarcodeDetector(imageData as unknown as ImageBitmapSource);
  if (native) return native;

  try {
    await ensureModule();
  } catch {
    return null;
  }

  const roi = downscaleIfNeeded(cropImageData(imageData, LIVE_PDF417_CROP), 1280);
  const cropped = await tryNativeDecode(roi, 'LocalAverage', false, true);
  if (cropped) return cropped;

  const scaled = downscaleIfNeeded(imageData, 1280);
  return tryNativeDecode(scaled, 'LocalAverage', false, true);
}

/**
 * Fast single-pass QR decode for live camera frames — used by the officer
 * wallet-ID verify scanner (src/pages/wallet/VerifyIdPage.tsx). Reuses the same
 * one-time zxing module init as the PDF417 path so the wasm is prepared once.
 */
export async function decodeQrFrame(imageData: ImageData): Promise<string | null> {
  try {
    await ensureModule();
  } catch {
    return null;
  }
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
  passes: number;
}

const NATIVE_BINARIZERS: ZxingBinarizer[] = ['LocalAverage', 'GlobalHistogram', 'FixedThreshold'];

/**
 * Decode a PDF417 barcode from an uploaded/captured photo.
 * Returns null if no barcode could be found after all passes.
 *
 * Strategy (ordered by likelihood of success and cost):
 *
 * Phase 0 — Platform BarcodeDetector (Chromium PDF417).
 *
 * Phase 1 — Native decode: pass the raw Blob to ZXing with each
 * built-in binarizer. ZXing's C++ core handles JPEG decode natively,
 * avoiding the lossy browser canvas pipeline entirely.
 *
 * Phase 2 — Preprocessed decode: if native decode fails (e.g. severe
 * glare, shadow, blur), load the image into a canvas and try our
 * custom preprocessing modes at multiple scales.
 */
export async function decodePdf417(file: File): Promise<Pdf417DecodeOutcome | null> {
  let passes = 0;

  const platform = await tryBarcodeDetector(file);
  if (platform) return { text: platform, passes: 0 };

  try {
    await ensureModule();
  } catch {
    return null;
  }

  for (const binarizer of NATIVE_BINARIZERS) {
    for (const denoise of [false, true]) {
      passes++;
      const text = await tryNativeDecode(file, binarizer, denoise, true);
      if (text) return { text, passes };
    }
  }

  const img = await loadImage(file);
  const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
  if (!maxDim) return null;

  const baseScale = maxDim > 4800 ? 4800 / maxDim : 1;
  const scales: number[] = [
    baseScale,
    Math.min(baseScale * 1.5, 1.0),
    baseScale * 0.75,
    baseScale * 0.5,
  ].filter((s, i, a) => a.indexOf(s) === i);

  const modes: ContrastMode[] = ['sharpen', 'linear', 'adaptive', 'minmax', 'binarize'];

  for (const mode of modes) {
    for (const scale of scales) {
      passes++;
      try {
        const imageData = toImageData(img, scale, mode);
        const text = await tryNativeDecode(imageData, 'LocalAverage', false, true);
        if (text) return { text, passes };
      } catch {
        // preprocessing or decode error — try next
      }
    }
  }

  return null;
}
