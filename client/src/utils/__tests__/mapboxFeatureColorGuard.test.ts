// Ratchet: every GeoJSON feature `color` property that feeds a Mapbox paint
// expression must pass through safeMapboxColor().
//
// Live defect 2026-09-15 (NavigationPage): the console logged
//   Failed to evaluate expression "["to-color",["get","color"]]".
//   Could not parse color from value 'var(--sev-warn)'
//   … 'var(--brand-gold)' … 'var(--sev-ok)'
// CLASS_META maps each crime class to a CSS variable — correct for the DOM
// legend, fatal inside a paint property. Mapbox GL resolves colors in a
// shader, where `var()` has no meaning, so `['get','color']` threw per
// feature and the crime layer painted nothing. Nothing in our own code
// errored, which is why it survived as a console flood.
//
// The guard already existed (safeMapboxColor, and the note in
// mapboxSafeLayer.ts that it "belongs at every config-to-mapbox seam") but
// was applied at only two of ten seams. This test is the mechanical check
// that a new seam cannot skip it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

import { safeMapboxColor } from '../mapboxSafeLayer';

const SRC = resolve(process.cwd(), 'src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Files that register a paint property reading the feature's `color`. */
function filesConsumingFeatureColor(): string[] {
  return walk(SRC).filter((f) => /\[\s*'get',\s*'color'\s*\]/.test(readFileSync(f, 'utf8')));
}

/**
 * Pull every `color:` assignment that sits inside a GeoJSON `properties`
 * object literal. Feature builders in this repo all use the same shape —
 * either `properties: { …, color: X, … }` on one line or a multi-line
 * `properties: {` block — so a bounded window after the `properties:` key
 * captures them without parsing TS.
 */
function featureColorAssignments(source: string): string[] {
  const out: string[] = [];
  const re = /properties:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    // Walk to the matching close brace so we never read past the literal.
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const block = source.slice(m.index, i + 1);
    for (const line of block.split('\n')) {
      // `scolor:`/`textColor:` etc. are separate properties with their own
      // paint expressions; only the plain `color` key is claimed here.
      if (/(^|[\s,{])color:/.test(line)) out.push(line.trim());
    }
  }
  return out;
}

describe('safeMapboxColor guards every feature-color seam', () => {
  const files = filesConsumingFeatureColor();

  it('finds the map modules that read ["get","color"]', () => {
    // Sanity floor: if the glob silently stops matching, the ratchet would
    // pass vacuously forever.
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)('%s routes feature colors through safeMapboxColor', (file) => {
    const source = readFileSync(file, 'utf8');
    const offenders = featureColorAssignments(source)
      .filter((line) => !line.includes('safeMapboxColor('));
    expect(
      offenders,
      `${relative(SRC, file)} assigns a feature \`color\` property without ` +
      `safeMapboxColor(). Mapbox GL cannot parse var(--x) in a paint ` +
      `property and drops the layer:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('safeMapboxColor resolves the values that broke the crime layer', () => {
  // Node/jsdom has no RMPG stylesheet, so these exercise the fallback table —
  // the same path a mid-theme-swap render takes.
  it.each([
    ['var(--sev-warn)', '#f59e0b'],
    ['var(--sev-ok)', '#22c55e'],
    ['var(--brand-gold)', '#d4a017'],
    ['var(--sev-critical)', '#ef4444'],
  ])('%s → %s', (input, expected) => {
    expect(safeMapboxColor(input, '#888888')).toBe(expected);
  });

  it('falls back rather than emitting an unparseable value', () => {
    expect(safeMapboxColor('var(--not-a-token)', '#888888')).toBe('#888888');
    expect(safeMapboxColor(undefined, '#888888')).toBe('#888888');
    expect(safeMapboxColor('#0f0', '#888888')).toBe('#0f0');
  });
});
