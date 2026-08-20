import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FALLBACKS } from '../chartPalette';

const css = readFileSync(resolve(__dirname, '../../styles/theme-palettes.css'), 'utf8');

const BLOCKS = [
  { name: 'night', marker: ':root,' },
  { name: 'day', marker: 'html.theme-light {' },
  { name: 'legacy-black', marker: 'html.theme-legacy-black {' },
  { name: 'blue-silver', marker: 'html.theme-blue-silver {' },
];

const RAMP = ['--chart-pri-1', '--chart-pri-2', '--chart-pri-3', '--chart-pri-4'];

function blockBody(marker: string): string {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

function declared(body: string, name: string): string | null {
  const m = body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  return m ? m[1].toLowerCase() : null;
}

// ── WCAG relative luminance / contrast ──
function srgb(c: number) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255);
}
function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ── OKLCH lightness (Ottosson) — only the L channel is needed ──
function oklabL(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [R, G, B] = [srgb((n >> 16) & 255), srgb((n >> 8) & 255), srgb(n & 255)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
}

describe('chart palette tokens', () => {
  for (const block of BLOCKS) {
    const body = () => blockBody(block.marker);

    it(`${block.name} defines the full priority ramp and the plot surface`, () => {
      const b = body();
      for (const name of [...RAMP, '--chart-plot-surface']) {
        expect(b, `${block.name} is missing ${name}`).toMatch(new RegExp(`${name}\\s*:`));
      }
    });

    it(`${block.name} priority ramp clears 3:1 against its plot well`, () => {
      const b = body();
      const well = declared(b, '--chart-plot-surface')!;
      expect(well, `${block.name} --chart-plot-surface must be a literal hex`).toBeTruthy();
      for (const name of RAMP) {
        const hex = declared(b, name)!;
        expect(hex, `${block.name} ${name} must be a literal hex`).toBeTruthy();
        expect(contrast(hex, well), `${block.name} ${name} (${hex}) on ${well}`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${block.name} priority ramp is a monotone ordinal scale`, () => {
      const b = body();
      const Ls = RAMP.map((n) => oklabL(declared(b, n)!));
      const deltas = Ls.slice(1).map((L, i) => L - Ls[i]);
      // All steps move the same direction, and each gap clears the 0.06 ordinal floor.
      expect(deltas.every((d) => d < 0) || deltas.every((d) => d > 0), `${block.name} ΔL ${deltas}`).toBe(true);
      for (const d of deltas) expect(Math.abs(d), `${block.name} ΔL ${deltas}`).toBeGreaterThanOrEqual(0.06);
    });
  }
});

// ── chartPalette.ts FALLBACKS binding ───────────────────────────────────
// FALLBACKS in chartPalette.ts duplicates the --chart-pri-1..4 and
// --chart-plot-surface literals from html.theme-blue-silver by hand (it has
// to — CSS custom properties aren't readable from plain TS at module scope).
// Nothing else ties that copy to the CSS, so editing the CSS values alone
// silently leaves the getComputedStyle-failure fallback path serving stale
// colors. This test is that binding: it fails the moment the two drift.
describe('chartPalette FALLBACKS mirrors html.theme-blue-silver', () => {
  const FALLBACK_KEYS = ['--chart-pri-1', '--chart-pri-2', '--chart-pri-3', '--chart-pri-4', '--chart-plot-surface'];

  it.each(FALLBACK_KEYS)('%s matches the CSS-declared value', (name) => {
    const body = blockBody('html.theme-blue-silver {');
    const cssValue = declared(body, name);
    expect(cssValue, `${name} must be a literal hex in html.theme-blue-silver`).toBeTruthy();
    expect(FALLBACKS[name], `chartPalette.ts FALLBACKS is missing ${name}`).toBeTruthy();
    expect(FALLBACKS[name].toLowerCase(), `FALLBACKS['${name}'] (${FALLBACKS[name]}) has drifted from the CSS value (${cssValue})`).toBe(cssValue);
  });
});
