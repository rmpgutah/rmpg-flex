const GOLDEN_RATIO_CONJUGATE = 0.61803398875;

/**
 * Deterministic HSL color from a string key.
 *
 * Two-stage mix: (1) DJB-style polynomial hash collects chars into a
 * 32-bit non-commutative integer (so "DV2" and "WB3" don't collide
 * just because their charCodes sum to the same value), then (2) the
 * unsigned hash is multiplied by `GOLDEN_RATIO_CONJUGATE` and the
 * fractional part used as the hue position. Multiplying by an
 * irrational maps adjacent hashes (1-bit apart) to opposite sides of
 * the hue wheel, so even sequential codes like "SL1"/"SL2"/"SL3" land
 * far apart on the color circle.
 *
 * Saturation + lightness are fixed for the dispatch dark theme.
 */
export function hashToHsl(code: string): string {
  if (!code) return 'hsl(0, 0%, 50%)';
  let h = 0;
  for (let i = 0; i < code.length; i++) {
    h = ((h << 5) - h + code.charCodeAt(i)) | 0;
  }
  const seed = (h >>> 0) * GOLDEN_RATIO_CONJUGATE;
  const hue = Math.floor((seed - Math.floor(seed)) * 360);
  return `hsl(${hue}, 65%, 55%)`;
}
