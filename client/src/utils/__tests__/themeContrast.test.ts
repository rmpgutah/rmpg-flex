import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(
  resolve(__dirname, '../../styles/theme-palettes.css'),
  'utf8',
);

// WCAG 2.1 relative luminance + contrast ratio.
function lum([r, g, b]: number[]): number {
  const f = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a: number[], b: number[]): number {
  const L1 = lum(a);
  const L2 = lum(b);
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// The four palette blocks. Markers match the convention already used by
// accentTokens.test.ts's `theme-block completeness` block -- ':root,' for night,
// since ':root' is the BASE layer and the true start of that rule.
const THEME_BLOCKS = [
  { name: 'night (:root / theme-dark / tactical-dark)', marker: ':root,' },
  { name: 'day (theme-light)', marker: 'html.theme-light {' },
  { name: 'legacy-black', marker: 'html.theme-legacy-black {' },
  { name: 'blue-silver (default)', marker: 'html.theme-blue-silver {' },
];

function blockOf(marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`theme-palettes.css: no block matching ${marker}`);
  const end = css.indexOf('\n}', start);
  if (end < 0) throw new Error(`theme-palettes.css: unterminated block ${marker}`);
  return css.slice(start, end);
}

// Resolve a token to RGB channels. Accepts either an `-rgb` triple (preferred,
// what Tailwind consumes) or a `#rrggbb` literal, so this survives Task 3
// converting the bare vars over to triples.
function channels(block: string, name: string): [number, number, number] {
  const triple = block.match(
    new RegExp(`--${name}-rgb:\\s*(\\d{1,3})\\s+(\\d{1,3})\\s+(\\d{1,3})`),
  );
  if (triple) return [Number(triple[1]), Number(triple[2]), Number(triple[3])];

  const hex = block.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`));
  if (hex) {
    const h = hex[1];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  throw new Error(`theme-palettes.css: cannot resolve --${name} in this block`);
}

// --spm-text-muted (206 usages, Spillman-replica chrome) and --toolbar-nav-text
// are SHADOW copies of --text-muted: before this program they carried its exact
// value in all four blocks. They are listed here so the lockstep is enforced by
// the guard instead of by memory -- lifting --text-muted alone silently left 206
// sites on the old sub-AA value.
const TEXT_ROLES = [
  'text-primary',
  'text-secondary',
  'text-muted',
  'spm-text-muted',
  'toolbar-nav-text',
];
const SURFACES = ['surface-base', 'surface-raised', 'surface-sunken'];

describe('theme contrast (WCAG AA, 4.5:1)', () => {
  // The affected labels are 8-11px. WCAG 1.4.3's 3:1 allowance is for LARGE
  // text only (18pt / 14pt bold); it does not apply here.
  for (const { name, marker } of THEME_BLOCKS) {
    describe(name, () => {
      const block = blockOf(marker);

      for (const role of TEXT_ROLES) {
        for (const surface of SURFACES) {
          it(`--${role} on --${surface} >= 4.5:1`, () => {
            const r = ratio(channels(block, role), channels(block, surface));
            expect(
              Number(r.toFixed(2)),
              `--${role} on --${surface} in ${name}`,
            ).toBeGreaterThanOrEqual(4.5);
          });
        }
      }
    });
  }
});

describe('contrast guard integrity', () => {
  it('reads the live surface, not the retired #0c1a2b', () => {
    // themeClassStamp.test.ts and themeBlueSilver.test.ts already had to correct
    // this same stale value. Pinning it here is what let 4,796 sub-AA labels ship.
    expect(css).not.toContain('#0c1a2b');
    expect(blockOf('html.theme-blue-silver {')).toContain('--surface-base: #22405f');
  });
});
