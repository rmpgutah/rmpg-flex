// ============================================================
// RMPG Flex — Forensic image enhancement (pure)
// ============================================================
// Live, visible enhancement for reading obscure/blurry plates. Two layers:
//   1. CSS filter presets applied to the <video> element — instant, GPU, whole
//      frame (the "color filter that brings out the letters").
//   2. A canvas pixel pipeline (applyPipeline) for the Plate Magnifier inset:
//      contrast-stretch → gamma → unsharp → invert/threshold, operating on the
//      magnified plate crop so the glyphs actually resolve.
// The statistical cores are reused from alprImagePrep (histogram / percentile /
// contrast LUT / unsharp). Everything here is pure + unit-tested; the canvas
// rasterization that calls applyPipeline lives in the component (not jsdom-able).
// ============================================================

import { luminanceHistogram, percentileBounds, contrastLUT, unsharpValue } from './alprImagePrep';

export interface EnhancePipeline {
  contrast: boolean;        // percentile contrast-stretch
  gamma: number;            // 1 = off; >1 lifts shadows, <1 deepens
  sharpen: number;          // unsharp amount, 0 = off
  threshold: number | null; // 0..1 binary cut on luminance, null = off
  grayscale: boolean;       // collapse to luminance first
  invert: boolean;          // photo-negative (false-color legibility)
}

export interface EnhancePreset {
  key: string;
  label: string;
  /** CSS `filter` value for the live full-frame <video> pass. '' = no-op. */
  css: string;
  /** Pixel pipeline for the magnifier crop. */
  pipeline: EnhancePipeline;
}

const P = (contrast: boolean, gamma: number, sharpen: number, threshold: number | null, grayscale: boolean, invert: boolean): EnhancePipeline =>
  ({ contrast, gamma, sharpen, threshold, grayscale, invert });

/** Ordered preset catalog — `none` first (stable index 0 for cycling). */
export const ENHANCE_PRESETS: EnhancePreset[] = [
  { key: 'none', label: 'Off', css: '', pipeline: P(false, 1, 0.4, null, false, false) },
  { key: 'plate-pop', label: 'Plate-Pop', css: 'contrast(1.8) saturate(1.6) brightness(1.05)', pipeline: P(true, 0.9, 1.0, null, false, false) },
  { key: 'contrast', label: 'Hi-Contrast', css: 'contrast(1.6) brightness(1.1)', pipeline: P(true, 1, 0.6, null, false, false) },
  { key: 'sharpen', label: 'Sharpen', css: 'contrast(1.3) saturate(0.85)', pipeline: P(true, 1, 1.6, null, false, false) },
  { key: 'threshold', label: 'Threshold', css: 'grayscale(1) contrast(2.2) brightness(1.05)', pipeline: P(true, 1, 0.6, 0.5, true, false) },
  { key: 'night', label: 'Night', css: 'brightness(1.7) contrast(1.35) saturate(1.15)', pipeline: P(true, 0.7, 0.5, null, false, false) },
  { key: 'false-color', label: 'False-Color', css: 'invert(1) hue-rotate(180deg) contrast(1.4)', pipeline: P(true, 1, 0.8, null, false, true) },
];

export function presetByKey(key: string): EnhancePreset | undefined {
  return ENHANCE_PRESETS.find((p) => p.key === key);
}

/** Next preset key when cycling the toolbar button. */
export function nextPresetKey(key: string): string {
  const i = ENHANCE_PRESETS.findIndex((p) => p.key === key);
  return ENHANCE_PRESETS[(i + 1) % ENHANCE_PRESETS.length].key;
}

export interface FilterAdjust { brightness?: number; contrast?: number }

/** Compose the live CSS `filter` string for the <video>: the preset's filter
 *  plus optional extra brightness/contrast multipliers from the strength slider. */
export function cssFilterFor(preset: EnhancePreset, adjust: FilterAdjust = {}): string {
  const parts: string[] = [];
  if (preset.css) parts.push(preset.css);
  if (adjust.brightness != null && adjust.brightness !== 1) parts.push(`brightness(${+adjust.brightness.toFixed(2)})`);
  if (adjust.contrast != null && adjust.contrast !== 1) parts.push(`contrast(${+adjust.contrast.toFixed(2)})`);
  return parts.join(' ');
}

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** 256→256 gamma LUT. gamma>1 lifts shadows; gamma<1 deepens them. */
export function gammaLUT(gamma: number): Uint8Array {
  const g = gamma <= 0 ? 1 : gamma;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = clampByte(255 * Math.pow(v / 255, 1 / g));
  return lut;
}

/** Binary luminance LUT: 0 below the cut, 255 at/above. cut in 0..1. */
export function thresholdLUT(cut: number): Uint8Array {
  const t = Math.max(0, Math.min(1, cut)) * 255;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = v >= t ? 255 : 0;
  return lut;
}

const luma = (r: number, g: number, b: number) => clampByte(r * 0.299 + g * 0.587 + b * 0.114 + 0.5);

/** Apply the pixel pipeline IN PLACE to an RGBA buffer. Pure (no canvas/DOM):
 *  grayscale → contrast-stretch → gamma → unsharp → invert → threshold.
 *  Alpha is never touched. */
export function applyPipeline(px: Uint8ClampedArray, width: number, height: number, pipe: EnhancePipeline): void {
  // 1. Grayscale.
  if (pipe.grayscale) {
    for (let i = 0; i < px.length; i += 4) { const y = luma(px[i], px[i + 1], px[i + 2]); px[i] = px[i + 1] = px[i + 2] = y; }
  }
  // 2. Percentile contrast stretch (recover detail from dark/washed crops).
  if (pipe.contrast) {
    const [lo, hi] = percentileBounds(luminanceHistogram(px));
    const lut = contrastLUT(lo, hi);
    for (let i = 0; i < px.length; i += 4) { px[i] = lut[px[i]]; px[i + 1] = lut[px[i + 1]]; px[i + 2] = lut[px[i + 2]]; }
  }
  // 3. Gamma.
  if (pipe.gamma && pipe.gamma !== 1) {
    const lut = gammaLUT(pipe.gamma);
    for (let i = 0; i < px.length; i += 4) { px[i] = lut[px[i]]; px[i + 1] = lut[px[i + 1]]; px[i + 2] = lut[px[i + 2]]; }
  }
  // 4. Unsharp mask (3×3 box-blur reference; skip 1px border). Crisps glyph edges.
  if (pipe.sharpen > 0 && width > 2 && height > 2) {
    const src = new Uint8ClampedArray(px);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const o = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) sum += src[((y + ky) * width + (x + kx)) * 4 + c];
          px[o + c] = unsharpValue(src[o + c], sum / 9, pipe.sharpen);
        }
      }
    }
  }
  // 5. Invert (photo-negative — sometimes the most legible for backlit plates).
  if (pipe.invert) {
    for (let i = 0; i < px.length; i += 4) { px[i] = 255 - px[i]; px[i + 1] = 255 - px[i + 1]; px[i + 2] = 255 - px[i + 2]; }
  }
  // 6. Threshold (binarize on luminance for maximum glyph/background separation).
  if (pipe.threshold != null) {
    const lut = thresholdLUT(pipe.threshold);
    for (let i = 0; i < px.length; i += 4) { const y = lut[luma(px[i], px[i + 1], px[i + 2])]; px[i] = px[i + 1] = px[i + 2] = y; }
  }
}
