// client/src/utils/redaction/blur.ts
// Canvas region effects for redaction. `pixelate` (pure mosaic math) is unit-
// tested; `applyRegionEffect` rasterizes onto a 2D context (browser only).
import type { NormBox, RedactionStyle } from './regions';

/** Mosaic an RGBA buffer in place: each block×block cell becomes its mean. */
export function pixelate(px: Uint8ClampedArray, w: number, h: number, block: number): void {
  const b = Math.max(1, Math.floor(block));
  for (let by = 0; by < h; by += b) {
    for (let bx = 0; bx < w; bx += b) {
      let r = 0, g = 0, bl = 0, n = 0;
      const yEnd = Math.min(h, by + b), xEnd = Math.min(w, bx + b);
      for (let y = by; y < yEnd; y++) for (let x = bx; x < xEnd; x++) {
        const o = (y * w + x) * 4; r += px[o]; g += px[o + 1]; bl += px[o + 2]; n++;
      }
      if (!n) continue;
      const ar = Math.round(r / n), ag = Math.round(g / n), ab = Math.round(bl / n);
      for (let y = by; y < yEnd; y++) for (let x = bx; x < xEnd; x++) {
        const o = (y * w + x) * 4; px[o] = ar; px[o + 1] = ag; px[o + 2] = ab;
      }
    }
  }
}

/** Apply a redaction effect to a denormalized px box on a 2D context. */
export function applyRegionEffect(
  ctx: CanvasRenderingContext2D, boxPx: NormBox, style: RedactionStyle, strength: number,
): void {
  const [x, y, w, h] = boxPx.map((v) => Math.round(v)) as NormBox;
  if (w < 1 || h < 1) return;
  if (style === 'box') { ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h); return; }
  if (style === 'blur') {
    ctx.save();
    ctx.filter = `blur(${Math.max(2, Math.round(strength))}px)`;
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(ctx.canvas, x, y, w, h, x, y, w, h);
    ctx.restore();
    return;
  }
  const img = ctx.getImageData(x, y, w, h);
  pixelate(img.data, w, h, Math.max(4, Math.round(strength)));
  ctx.putImageData(img, x, y);
}
