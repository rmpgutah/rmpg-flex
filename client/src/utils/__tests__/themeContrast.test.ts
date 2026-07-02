import { describe, it, expect } from 'vitest';

// WCAG relative luminance + contrast ratio.
function lum([r, g, b]: number[]) {
  const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: number[], b: number[]) {
  const L1 = lum(a), L2 = lum(b);
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// Primary text on base surface must clear AA (4.5:1) in every theme.
const NIGHT = { textPrimary: [230, 237, 245], surfaceBase: [13, 23, 34] };
const DAY = { textPrimary: [26, 26, 26], surfaceBase: [236, 233, 221] };
const BLUE_SILVER = { textPrimary: [238, 242, 247], surfaceBase: [12, 26, 43], brandGold: [183, 194, 207] };

describe('theme contrast (AA)', () => {
  it('night primary text on base >= 4.5:1', () => {
    expect(ratio(NIGHT.textPrimary, NIGHT.surfaceBase)).toBeGreaterThanOrEqual(4.5);
  });
  it('day primary text on base >= 4.5:1', () => {
    expect(ratio(DAY.textPrimary, DAY.surfaceBase)).toBeGreaterThanOrEqual(4.5);
  });
  it('blue-silver primary text on base >= 4.5:1', () => {
    expect(ratio(BLUE_SILVER.textPrimary, BLUE_SILVER.surfaceBase)).toBeGreaterThanOrEqual(4.5);
  });
  it('blue-silver metallic accent (--brand-gold, silver here) on base >= 4.5:1', () => {
    expect(ratio(BLUE_SILVER.brandGold, BLUE_SILVER.surfaceBase)).toBeGreaterThanOrEqual(4.5);
  });
});
