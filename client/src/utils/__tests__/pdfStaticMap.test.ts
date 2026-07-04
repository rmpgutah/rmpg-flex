import { describe, it, expect } from 'vitest';
import { applyBlueprintMonochrome, BLUEPRINT_MONOCHROME_CONTRAST } from '../pdfStaticMap';

describe('applyBlueprintMonochrome (property map blueprint pass)', () => {
  it('converts a color pixel to a single gray value (R=G=B)', () => {
    // A saturated map-green (e.g. park/vegetation fill).
    const px = new Uint8ClampedArray([40, 140, 60, 255]);
    applyBlueprintMonochrome(px);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
  });

  it('leaves alpha untouched', () => {
    const px = new Uint8ClampedArray([200, 60, 60, 128]);
    applyBlueprintMonochrome(px);
    expect(px[3]).toBe(128);
  });

  it('pushes dark pixels darker and light pixels lighter (contrast stretch)', () => {
    // Dark asphalt-ish gray, mid-gray, and near-white background.
    const dark = new Uint8ClampedArray([60, 60, 60, 255]);
    const mid = new Uint8ClampedArray([128, 128, 128, 255]);
    const light = new Uint8ClampedArray([220, 220, 220, 255]);
    applyBlueprintMonochrome(dark);
    applyBlueprintMonochrome(mid);
    applyBlueprintMonochrome(light);
    expect(dark[0]).toBeLessThan(60);
    expect(light[0]).toBeGreaterThan(220);
    // Exact mid-gray (128) sits on the contrast pivot and is unchanged.
    expect(mid[0]).toBe(128);
  });

  it('clamps to the valid 0-255 range at the extremes', () => {
    const black = new Uint8ClampedArray([0, 0, 0, 255]);
    const white = new Uint8ClampedArray([255, 255, 255, 255]);
    applyBlueprintMonochrome(black);
    applyBlueprintMonochrome(white);
    expect(black[0]).toBe(0);
    expect(white[0]).toBe(255);
  });

  it('processes multiple pixels in one buffer independently', () => {
    const px = new Uint8ClampedArray([
      10, 10, 10, 255,    // pixel 0: dark
      245, 245, 245, 255, // pixel 1: light
    ]);
    applyBlueprintMonochrome(px);
    expect(px[0]).toBeLessThan(10);
    expect(px[4]).toBeGreaterThan(245);
  });

  it('the exported contrast constant matches what the transform actually applies', () => {
    const lum = 100;
    const expected = Math.max(0, Math.min(255, (lum - 128) * BLUEPRINT_MONOCHROME_CONTRAST + 128));
    const px = new Uint8ClampedArray([lum, lum, lum, 255]);
    applyBlueprintMonochrome(px);
    expect(px[0]).toBe(Math.round(expected));
  });
});
