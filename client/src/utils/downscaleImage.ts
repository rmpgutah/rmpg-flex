// Downscale a Blob/File before upload so ALPR scans go faster (smaller upload
// + smaller image for the model). Plates are legible far below sensor res, so
// there's no accuracy cost. Any failure returns the original blob unchanged —
// downscaling must never block a scan.

export function downscaleDims(w: number, h: number, maxDim: number): { w: number; h: number; scaled: boolean } {
  const scale = Math.min(1, maxDim / Math.max(w, h));
  if (scale >= 1) return { w, h, scaled: false };
  return { w: Math.round(w * scale), h: Math.round(h * scale), scaled: true };
}

export async function downscaleImage(input: Blob, maxDim = 1280, quality = 0.8): Promise<Blob> {
  try {
    if (typeof createImageBitmap !== 'function') return input;
    const bmp = await createImageBitmap(input);
    const { w, h, scaled } = downscaleDims(bmp.width, bmp.height, maxDim);
    if (!scaled) { bmp.close?.(); return input; }
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = (canvas as OffscreenCanvas | HTMLCanvasElement).getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) { bmp.close?.(); return input; }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    if ('convertToBlob' in canvas) {
      return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality });
    }
    return await new Promise<Blob>((res, rej) =>
      (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/jpeg', quality));
  } catch {
    return input;
  }
}
