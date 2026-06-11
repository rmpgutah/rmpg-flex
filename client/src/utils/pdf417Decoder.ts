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
function ensureModule(): void {
  if (prepared) return;
  prepared = true;
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? wasmUrl : prefix + path,
    },
  });
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

function toImageData(img: HTMLImageElement, scale: number, contrastBoost: boolean): ImageData {
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  if (contrastBoost) {
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const v = Math.min(255, Math.max(0, (lum - 128) * 1.8 + 128));
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  }
  return data;
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

  const baseScale = maxDim > 2600 ? 2600 / maxDim : 1;
  const scales = [baseScale];
  if (maxDim * baseScale < 1400) scales.push(Math.min(2, (1400 / maxDim) * 2));
  else scales.push(baseScale * 1.5); // upscale pass sharpens tight module grids

  let passes = 0;
  for (const contrastBoost of [false, true]) {
    for (const scale of scales) {
      passes++;
      try {
        const results = await readBarcodes(toImageData(img, scale, contrastBoost), {
          formats: ['PDF417'],
          tryHarder: true,
          tryRotate: true,
          tryInvert: true,
          tryDownscale: true,
          textMode: 'Plain',  // raw bytes as-is — AAMVA needs exact control chars
          maxNumberOfSymbols: 1,
        });
        const text = results[0]?.text;
        if (text && text.length > 20) return { text, passes };
      } catch {
        // decode error on this pass — try the next configuration
      }
    }
  }
  return null;
}
