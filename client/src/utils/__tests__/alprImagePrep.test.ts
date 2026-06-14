import { describe, it, expect } from 'vitest';
import { luminanceHistogram, percentileBounds, contrastLUT, unsharpValue, ocrScale, computeCropAndScale } from '../alprImagePrep';

/** Build an RGBA buffer of n grayscale pixels with the given luminance value. */
function gray(values: number[]): Uint8ClampedArray {
  const a = new Uint8ClampedArray(values.length * 4);
  values.forEach((v, i) => { a[i * 4] = v; a[i * 4 + 1] = v; a[i * 4 + 2] = v; a[i * 4 + 3] = 255; });
  return a;
}

describe('alprImagePrep — histogram + bounds', () => {
  it('luminanceHistogram counts each bin', () => {
    const h = luminanceHistogram(gray([0, 0, 128, 255]));
    expect(h[0]).toBe(2); expect(h[128]).toBe(1); expect(h[255]).toBe(1);
    expect(h.reduce((a, b) => a + b)).toBe(4);
  });
  it('percentileBounds trims outliers to the bulk range', () => {
    // 100 mid-grey pixels @120 + 1 black + 1 white → bounds hug 120
    const vals = [0, ...Array(100).fill(120), 255];
    const [lo, hi] = percentileBounds(luminanceHistogram(gray(vals)), 0.05, 0.95);
    expect(lo).toBe(120); expect(hi).toBe(120 + 1); // hi guaranteed > lo
  });
  it('percentileBounds defaults sanely on an empty histogram', () => {
    expect(percentileBounds(new Array(256).fill(0))).toEqual([0, 255]);
  });
});

describe('alprImagePrep — contrast LUT', () => {
  it('stretches [lo,hi] to [0,255]', () => {
    const lut = contrastLUT(50, 200);
    expect(lut[50]).toBe(0);
    expect(lut[200]).toBe(255);
    expect(lut[125]).toBeGreaterThan(120); expect(lut[125]).toBeLessThan(135); // ~midpoint
    expect(lut[10]).toBe(0);    // below lo clamps
    expect(lut[250]).toBe(255); // above hi clamps
  });
  it('never divides by zero when hi==lo', () => {
    const lut = contrastLUT(100, 100);
    expect(lut[100]).toBeGreaterThanOrEqual(0);
    expect(lut[255]).toBe(255);
  });
});

describe('alprImagePrep — unsharp', () => {
  it('amplifies the difference from the local blur and clamps', () => {
    expect(unsharpValue(150, 100, 1)).toBe(200);   // 150 + 1*(50)
    expect(unsharpValue(100, 150, 1)).toBe(50);     // 100 + 1*(-50)
    expect(unsharpValue(250, 0, 1)).toBe(255);      // clamps high
    expect(unsharpValue(5, 250, 1)).toBe(0);        // clamps low
    expect(unsharpValue(120, 120, 0.8)).toBe(120);  // no edge → unchanged
  });
});

describe('alprImagePrep — ocrScale', () => {
  it('upscales a small crop toward targetWidth (below the maxWidth ceiling)', () => {
    // min(1600/400=4, max(1, 1280/400=3.2)=3.2) = 3.2
    expect(ocrScale(400, 1280, 1600)).toBeCloseTo(3.2, 10);
  });
  it('clamps an already-large image to the maxWidth ceiling (downscale)', () => {
    // min(1600/2000=0.8, max(1, 1280/2000=0.64)=1) = 0.8 — ceiling wins
    expect(ocrScale(2000, 1280, 1600)).toBeCloseTo(0.8, 10);
  });
  it('guards width<=0 by returning scale 1', () => {
    expect(ocrScale(0, 1280, 1600)).toBe(1);
    expect(ocrScale(-50, 1280, 1600)).toBe(1);
  });
  it('is a no-op (scale 1) when the width already equals targetWidth under the ceiling', () => {
    // min(1600/1280=1.25, max(1, 1280/1280=1)=1) = 1
    expect(ocrScale(1280, 1280, 1600)).toBe(1);
  });
});

describe('alprImagePrep — computeCropAndScale', () => {
  it('maps a centered fractional ROI onto source pixels with the right draw size', () => {
    // 1000x800, crop {0.25,0.25,0.5,0.5} → sx=250 sy=200 sw=500 sh=400
    // scale = ocrScale(500,1280,1600) = min(3.2, max(1, 2.56)=2.56) = 2.56
    // dw = round(500*2.56)=1280, dh = round(400*2.56)=1024
    const r = computeCropAndScale(1000, 800, { crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
    expect(r.sx).toBe(250);
    expect(r.sy).toBe(200);
    expect(r.sw).toBe(500);
    expect(r.sh).toBe(400);
    expect(r.scale).toBeCloseTo(2.56, 10);
    expect(r.dw).toBe(1280);
    expect(r.dh).toBe(1024);
  });
  it('uses the full frame (offset 0,0 + full dimensions) when no crop is given', () => {
    // sw=1000 → scale = ocrScale(1000,1280,1600)=min(1.6, max(1,1.28)=1.28)=1.28
    const r = computeCropAndScale(1000, 800, {});
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
    expect(r.sw).toBe(1000);
    expect(r.sh).toBe(800);
    expect(r.scale).toBeCloseTo(1.28, 10);
    expect(r.dw).toBe(1280);
    expect(r.dh).toBe(Math.round(800 * 1.28)); // 1024
  });
});
