import { describe, it, expect } from 'vitest';
import {
  ENHANCE_PRESETS, presetByKey, cssFilterFor, gammaLUT, thresholdLUT, applyPipeline,
} from './imageEnhance';

describe('ENHANCE_PRESETS', () => {
  it('has a stable "none" preset first and unique keys', () => {
    expect(ENHANCE_PRESETS[0].key).toBe('none');
    const keys = ENHANCE_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('includes the "plate-pop" letter-popping preset and a threshold preset', () => {
    expect(presetByKey('plate-pop')).toBeTruthy();
    expect(presetByKey('threshold')?.pipeline.threshold).not.toBeNull();
  });
  it('every preset carries a CSS filter string except none', () => {
    for (const p of ENHANCE_PRESETS) {
      if (p.key === 'none') expect(p.css).toBe('');
      else expect(p.css.length).toBeGreaterThan(0);
    }
  });
});

describe('cssFilterFor', () => {
  it('returns the bare preset css with no adjustments', () => {
    expect(cssFilterFor(presetByKey('night')!)).toContain('brightness');
  });
  it('appends brightness/contrast multipliers when adjusted', () => {
    const f = cssFilterFor(presetByKey('none')!, { brightness: 1.4, contrast: 1.2 });
    expect(f).toContain('brightness(1.4)');
    expect(f).toContain('contrast(1.2)');
  });
  it('an unadjusted none preset yields an empty (no-op) filter', () => {
    expect(cssFilterFor(presetByKey('none')!)).toBe('');
  });
});

describe('gammaLUT', () => {
  it('is identity-ish at gamma 1 and monotonic non-decreasing', () => {
    const lut = gammaLUT(1);
    expect(lut[0]).toBe(0); expect(lut[255]).toBe(255);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
  });
  it('gamma > 1 lifts shadows (midpoint brighter than linear)', () => {
    expect(gammaLUT(2.2)[128]).toBeGreaterThan(128);
  });
});

describe('thresholdLUT', () => {
  it('produces a binary 0/255 LUT split at the cut point', () => {
    const lut = thresholdLUT(0.5);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    expect(new Set(Array.from(lut))).toEqual(new Set([0, 255]));
  });
});

describe('applyPipeline (pure pixel ops on an RGBA buffer)', () => {
  // 2x2 RGBA test buffer.
  const make = () => new Uint8ClampedArray([
    10, 20, 30, 255, 200, 210, 220, 255,
    60, 60, 60, 255, 250, 5, 5, 255,
  ]);

  it('grayscale collapses each pixel to r==g==b', () => {
    const px = make();
    applyPipeline(px, 2, 2, { contrast: false, gamma: 1, sharpen: 0, threshold: null, grayscale: true, invert: false });
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i]).toBe(px[i + 1]);
      expect(px[i + 1]).toBe(px[i + 2]);
    }
  });

  it('invert flips every channel (v -> 255-v)', () => {
    const px = make();
    applyPipeline(px, 2, 2, { contrast: false, gamma: 1, sharpen: 0, threshold: null, grayscale: false, invert: true });
    expect(px[0]).toBe(245); // 255-10
    expect(px[1]).toBe(235); // 255-20
  });

  it('preserves alpha and never throws on a 1px image', () => {
    const px = new Uint8ClampedArray([100, 100, 100, 128]);
    expect(() => applyPipeline(px, 1, 1, { contrast: true, gamma: 0.8, sharpen: 1, threshold: 0.5, grayscale: true, invert: false })).not.toThrow();
    expect(px[3]).toBe(128);
  });
});
