// ============================================================
// RMPG Flex — MAP_PALETTE is the only source of basemap color
// ============================================================
// MapboxMiniMap (the dispatch mini-map) defined its own
// `applySteelBlueMapTheme()` that recolored 'background' and 'water'. It ran on
// the map's 'load' event — i.e. AFTER applyRmpgBasemap() had already run on
// 'style.load' — so it silently overwrote two colors of the shared palette:
//
//     canonical MAP_PALETTE      local override
//     land  #22405f              background #0d1722
//     water #142840              water      #0a1420
//
// Because 'load' always fires after 'style.load', the override always won. The
// dispatch mini-map therefore rendered near-black while the Map module rendered
// navy for the same city — reported 2026-07-31 as "the dispatch map doesn't
// match". Nothing errored; the two surfaces just quietly disagreed.
//
// applyRmpgBasemap already sets background and water, PLUS the gold arterials,
// silver roads and label ramp the local helper never touched — so a competing
// recolor is always a downgrade, not just a duplicate.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MAP_PALETTE } from '../mapboxBasemap';

const SRC_ROOT = resolve(__dirname, '..', '..');
const BASEMAP_MODULE = 'utils/mapboxBasemap.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Drop comments before pattern-scanning.
 *
 *  Not cosmetic: these checks describe the banned pattern in their own comments,
 *  and the fix for each defect leaves a comment naming what was removed. Without
 *  this, every ratchet here fails on its own documentation — which is exactly
 *  what happened while writing them. Scan code, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // /* … */ and JSX {/* … */}
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // // … (the [^:] keeps https:// intact)
}

/** Every module except the palette owner itself, comments removed. */
function consumerModules(): Array<{ rel: string; body: string }> {
  return walk(SRC_ROOT)
    .map((path) => ({ rel: path.slice(SRC_ROOT.length + 1).replace(/\\/g, '/'), path }))
    .filter(({ rel }) => rel !== BASEMAP_MODULE)
    .map(({ rel, path }) => ({ rel, body: stripComments(readFileSync(path, 'utf8')) }));
}

describe('map basemap palette has one owner', () => {
  it('MAP_PALETTE still defines the navy land/water the screenshots show', () => {
    // Pins the values the rest of this file reasons about.
    expect(MAP_PALETTE.land).toBe('#22405f');
    expect(MAP_PALETTE.water).toBe('#142840');
  });

  it('no module outside mapboxBasemap.ts recolors background or water', () => {
    // Catches a re-introduced local theming helper by what it DOES, rather than
    // by name — a rename would sail past a name-based check.
    const offenders: string[] = [];
    for (const { rel, body } of consumerModules()) {
      const recolorsBackground = /setPaintProperty[\s\S]{0,120}?['"]background['"][\s\S]{0,80}?background-color/.test(body)
        || /trySetPaint\(\s*['"]background['"]/.test(body);
      const recolorsWater = /setPaintProperty[\s\S]{0,120}?['"]water['"][\s\S]{0,80}?fill-color/.test(body)
        || /trySetPaint\(\s*['"]water['"]/.test(body);
      if (recolorsBackground || recolorsWater) offenders.push(rel);
    }
    expect(
      offenders,
      'These recolor the basemap outside MAP_PALETTE. Because applyRmpgBasemap runs '
        + "on 'style.load' and component code typically runs on 'load', a local recolor "
        + 'silently wins and that surface drifts away from every other map.',
    ).toEqual([]);
  });

  it('the retired near-black mini-map values are gone for good', () => {
    const offenders = consumerModules()
      .filter(({ body }) => body.includes('#0d1722') || body.includes('#0a1420'))
      // The explanatory comment left behind in MapboxMiniMap is allowed to name
      // them; actual color assignments are not.
      .filter(({ body }) => /(background-color|fill-color|background)\s*['":,]?\s*['"]#0(d1722|a1420)['"]/.test(body))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('the dispatch mini-map applies the shared basemap', () => {
    const mini = stripComments(readFileSync(join(SRC_ROOT, 'components/MapboxMiniMap.tsx'), 'utf8'));
    expect(mini).toMatch(/applyRmpgBasemap\(map, \{ variant: 'dark' \}\)/);
    expect(mini).not.toMatch(/applySteelBlueMapTheme/);
  });

  it('nothing applies a CSS filter to the Mapbox canvas', () => {
    // MapboxMiniMap shipped `.mapboxgl-canvas { filter: grayscale() sepia()
    // hue-rotate() ... }` to fake a steel-blue basemap. Two failures in one:
    //
    //  1. it ran over the FINISHED canvas, destroying MAP_PALETTE's measured
    //     contrast ratios (gold arterials at 3.63:1, label gold at 4.63:1);
    //  2. the selector was global. A bare `.mapboxgl-canvas` in JSX is not
    //     component-scoped, so while any mini-map was mounted it tinted EVERY
    //     Mapbox canvas in the document — and the tint blinked in and out as
    //     mini-maps mounted/unmounted.
    const offenders: string[] = [];
    for (const { rel, body } of consumerModules()) {
      // A `.mapboxgl-canvas` rule whose declaration block sets `filter:`.
      if (/\.mapboxgl-canvas\s*\{[^}]*\bfilter\s*:/.test(body)) offenders.push(rel);
    }
    expect(
      offenders,
      'Tint the basemap through MAP_PALETTE, never with a canvas filter — and note '
        + 'a bare .mapboxgl-canvas selector inside a component is global, not scoped.',
    ).toEqual([]);
  });
});
