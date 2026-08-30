// ============================================================
// RMPG Flex — PDF417 payload helpers (no WASM)
// ============================================================
// Pure helpers shared by the zxing-wasm decoder and its tests so we can
// assert crop/extract behaviour without instantiating the C++ module.

export type ZxingReadLike = {
  isValid?: boolean;
  bytes?: Uint8Array;
  text?: string;
};

/**
 * Prefer latin-1 bytes (AAMVA uses 0x1E RS / 0x1C FS in the header).
 * Fall back to `.text` when bytes are empty. Accept a decode even when
 * ZXing marks `isValid` false — PDF417 error-correction can still recover
 * a usable AAMVA string from a slightly damaged card.
 */
export function extractZxingText(r: ZxingReadLike | undefined | null): string | null {
  if (!r) return null;
  const fromBytes = r.bytes && r.bytes.length
    ? new TextDecoder('latin1').decode(r.bytes)
    : '';
  const fromText = r.text || '';
  const raw = fromBytes.length >= fromText.length ? fromBytes : fromText;
  if (!raw || raw.length < 20) return null;
  return raw;
}

export interface CropFractions {
  xFrac: number;
  yFrac: number;
  wFrac: number;
  hFrac: number;
}

/** Copy a fractional ROI out of an ImageData (no canvas — vitest-safe). */
export function cropImageData(src: ImageData, opts: CropFractions): ImageData {
  const x0 = Math.max(0, Math.floor(src.width * opts.xFrac));
  const y0 = Math.max(0, Math.floor(src.height * opts.yFrac));
  const cw = Math.max(1, Math.min(src.width - x0, Math.floor(src.width * opts.wFrac)));
  const ch = Math.max(1, Math.min(src.height - y0, Math.floor(src.height * opts.hFrac)));
  const out = new ImageData(cw, ch);
  const s = src.data;
  const d = out.data;
  for (let y = 0; y < ch; y++) {
    const srcOff = ((y0 + y) * src.width + x0) * 4;
    const dstOff = y * cw * 4;
    d.set(s.subarray(srcOff, srcOff + cw * 4), dstOff);
  }
  return out;
}

/** Default live-viewfinder crop: the PDF417 strip on the back of an ID-1 card. */
export const LIVE_PDF417_CROP: CropFractions = {
  xFrac: 0.05,
  yFrac: 0.10,
  wFrac: 0.90,
  hFrac: 0.45,
};
