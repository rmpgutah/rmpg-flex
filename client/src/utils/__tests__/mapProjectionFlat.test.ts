// ============================================================
// RMPG Flex — every Mapbox map must stay flat (Mercator), not Globe
// ============================================================
// mapbox-gl-js v3 defaults every new map to the 3D Globe projection unless
// `projection` is set explicitly at construction. RMPG Flex is a CAD/dispatch
// app: job pins, unit positions, and breadcrumbs need predictable, flat
// spatial reasoning at every zoom level, not a spinning sphere. Nothing in
// this codebase ever opted OUT of the library default, so every map surface
// silently rendered as Globe once zoomed out past mapbox-gl's globe/mercator
// auto-switch threshold (~zoom 5) — visible as the earth's curvature, and
// (found live 2026-08-09) job markers visually compressing toward the
// center meridian into a north-south line, since a globe viewed at a
// shallow angle foreshortens longitude much more than latitude.
//
// useMapProjection's own React state already defaulted to 'mercator' — the
// bug was that nothing ever pushed that default onto the REAL map instance,
// so the UI could claim "Mercator (Flat)" while the underlying map was
// actually rendering Globe until a user manually cycled the toggle.
//
// Source scan rather than behavioural: jsdom has no WebGL/globe rendering to
// assert against, so this checks that every real `new mapboxgl.Map(` call
// site sets `projection: 'mercator'` explicitly rather than relying on the
// library default.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC_ROOT = resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** True when `new mapboxgl.Map(` at `idx` is inside a `//` comment on its line. */
function isCommentedOut(body: string, idx: number): boolean {
  const lineStart = body.lastIndexOf('\n', idx) + 1;
  return body.slice(lineStart, idx).includes('//');
}

/** Brace-matched body of the object literal passed to `new mapboxgl.Map(...)`. */
function extractMapCallBody(body: string, callIdx: number): string {
  const openBrace = body.indexOf('{', callIdx);
  let depth = 0;
  for (let i = openBrace; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') {
      depth--;
      if (depth === 0) return body.slice(openBrace, i + 1);
    }
  }
  return body.slice(openBrace);
}

interface MapCallSite { path: string; line: number; optionsBody: string }

function findMapCallSites(): MapCallSite[] {
  const sites: MapCallSite[] = [];
  for (const path of walk(SRC_ROOT)) {
    const body = readFileSync(path, 'utf8');
    const re = /new mapboxgl\.Map\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      if (isCommentedOut(body, m.index)) continue;
      const line = body.slice(0, m.index).split('\n').length;
      sites.push({
        path: path.replace(SRC_ROOT, 'client/src'),
        line,
        optionsBody: extractMapCallBody(body, m.index),
      });
    }
  }
  return sites;
}

describe('Mapbox projection stays flat', () => {
  it('finds the map-constructing call sites (guards against a broken scan)', () => {
    // A silently-empty scan would make the assertion below pass vacuously.
    expect(findMapCallSites().length).toBeGreaterThan(15);
  });

  it("every `new mapboxgl.Map()` call site sets projection: 'mercator' explicitly", () => {
    const offenders = findMapCallSites()
      .filter((site) => !/projection:\s*['"]mercator['"]/.test(site.optionsBody))
      .map((site) => `${site.path}:${site.line}`);

    expect(
      offenders,
      "mapbox-gl v3 defaults to the 3D Globe projection when `projection` is omitted. "
        + "Add `projection: 'mercator'` to the constructor options at each site listed above "
        + '— see utils/mapboxMap.ts for the pattern.',
    ).toEqual([]);
  });
});
