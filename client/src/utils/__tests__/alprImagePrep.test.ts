import { describe, it, expect } from 'vitest';
import { luminanceHistogram, percentileBounds, contrastLUT, unsharpValue } from '../alprImagePrep';

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
