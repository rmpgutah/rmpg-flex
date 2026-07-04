import { describe, it, expect } from 'vitest';
import { applyBlueprintMonochrome } from '../pdfStaticMap';

describe('applyBlueprintMonochrome (property map blueprint pass)', () => {
  it('converts a color pixel to a single gray value (R=G=B)', () => {
    // A saturated map-green (e.g. park/vegetation fill), paired with a
    // contrasting pixel so the buffer has real range to stretch.
    const px = new Uint8ClampedArray([40, 140, 60, 255, 240, 240, 240, 255]);
    applyBlueprintMonochrome(px);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
  });

  it('leaves alpha untouched', () => {
    const px = new Uint8ClampedArray([200, 60, 60, 128, 20, 20, 20, 200]);
    applyBlueprintMonochrome(px);
    expect(px[3]).toBe(128);
    expect(px[7]).toBe(200);
  });

  it('stretches the darkest pixel in the buffer to black and the lightest to white', () => {
    const px = new Uint8ClampedArray([
      80, 80, 80, 255,    // darkest
      150, 150, 150, 255, // mid
      200, 200, 200, 255, // lightest
    ]);
    applyBlueprintMonochrome(px);
    expect(px[0]).toBe(0);
    expect(px[8]).toBe(255);
    // Mid pixel lands strictly between the two stretched extremes.
    expect(px[4]).toBeGreaterThan(0);
    expect(px[4]).toBeLessThan(255);
  });

  it('regression: a low-contrast, near-white source (e.g. mapbox/light-v11) is stretched into a visible range instead of clipping to solid white', () => {
    // Reproduces the actual bug: a light basemap style sits almost
    // entirely in the 235-255 band. A fixed-pivot contrast stretch pushed
    // this to solid 255 (the map "disappeared" on the rendered PDF). The
    // auto-levels pass must expand this narrow range across 0-255 so the
    // road/building pixels stay visibly darker than the background.
    const px = new Uint8ClampedArray([
      255, 255, 255, 255, // background
      255, 255, 255, 255, // background
      240, 240, 240, 255, // faint road/building line
      255, 255, 255, 255, // background
    ]);
    applyBlueprintMonochrome(px);
    // Background (the max) stretches to full white...
    expect(px[0]).toBe(255);
    // ...but the darker road pixel is now clearly visible (not still ~240,
    // and nowhere near clipped to white) — this is the "there is nothing
    // to see" bug: it must read as a distinct value, not disappear.
    expect(px[8]).toBe(0);
    expect(px[8]).toBeLessThan(px[0]);
  });

  it('clamps to the valid 0-255 range at the extremes', () => {
    const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    applyBlueprintMonochrome(px);
    expect(px[0]).toBe(0);
    expect(px[4]).toBe(255);
  });

  it('a perfectly flat/blank buffer (min === max) renders uniform mid-gray instead of dividing by zero', () => {
    const px = new Uint8ClampedArray([180, 180, 180, 255, 180, 180, 180, 255]);
    applyBlueprintMonochrome(px);
    expect(Number.isFinite(px[0])).toBe(true);
    expect(px[0]).toBe(128);
    expect(px[4]).toBe(128);
  });
});
