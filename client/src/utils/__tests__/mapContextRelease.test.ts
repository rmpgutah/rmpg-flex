// ============================================================
// RMPG Flex — every Mapbox map must release its WebGL context
// ============================================================
// `unregisterMapInstance()` only drops OUR bookkeeping entry from the module
// registry. It does not release anything Mapbox owns: the map keeps a WebGL
// context, a canvas, tile requests, and window-level listeners alive until
// `map.remove()` is called. A component that unregisters but never removes
// therefore leaks a live GL context on every unmount.
//
// This matters app-wide, not just on the leaking page. Browsers cap the number
// of simultaneous WebGL contexts (~16 in Chrome) and silently kill the OLDEST
// when that ceiling is crossed — so the visible symptom is some *other* map
// going blank, far from the component actually responsible. Found 2026-07-31
// in PatrolPage (leaked per visit) and DispatchMiniMap (leaked per dispatch
// call, so it climbed fastest).
//
// Source scan rather than behavioural: the leak only manifests after enough
// mount/unmount cycles to exhaust a real browser's context pool, which jsdom
// has no notion of — it has no WebGL implementation at all.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC_ROOT = resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Factory modules construct a map and hand it straight back to the caller,
// which owns teardown. They must NOT call remove() themselves. Exempt by path,
// and the exemption is itself verified below so it cannot silently rot into
// cover for a real leak.
const FACTORY_MODULES = ['utils/mapboxMap.ts'];

function isFactory(path: string): boolean {
  return FACTORY_MODULES.some((f) => path.endsWith(f));
}

/** Files that construct a Mapbox map. */
function mapConstructingFiles(): Array<{ path: string; body: string }> {
  return walk(SRC_ROOT)
    .map((path) => ({ path, body: readFileSync(path, 'utf8') }))
    .filter(({ body }) => body.includes('new mapboxgl.Map('));
}

/** Files that both construct AND own a map for the lifetime of a component. */
function mapOwningFiles(): Array<{ path: string; body: string }> {
  return mapConstructingFiles().filter(({ path }) => !isFactory(path));
}

describe('Mapbox WebGL context release', () => {
  it('finds the map-owning modules (guards against a broken scan)', () => {
    // A silently-empty scan would make the assertion below pass vacuously.
    expect(mapOwningFiles().length).toBeGreaterThan(10);
  });

  it('every exempted module really is a factory that hands the map to its caller', () => {
    // Without this, adding a path to FACTORY_MODULES would be an unchecked way
    // to silence a genuine leak.
    for (const f of FACTORY_MODULES) {
      const hit = mapConstructingFiles().find(({ path }) => path.endsWith(f));
      expect(hit, `exempt module ${f} no longer constructs a map — drop the exemption`).toBeTruthy();
      // A factory returns the map and never parks it in a component ref.
      expect(hit!.body, `${f} must return the map to its caller`).toMatch(/return map;/);
      expect(hit!.body, `${f} parks the map in a ref — it owns the map and is not a factory`)
        .not.toMatch(/(mapRef|mapInstanceRef)\.current\s*=\s*map\b/);
    }
  });

  it('every map-owning module calls map.remove(), not just unregisterMapInstance()', () => {
    const offenders: string[] = [];

    for (const { path, body } of mapOwningFiles()) {
      // `.remove()` on a ref/local that holds the map, in any of the shapes
      // used across this codebase (optional chaining included — an earlier
      // version of this audit missed `mapRef.current?.remove()` and produced
      // a false positive on FleetDashboardPage).
      const releases = /(\bmapRef\.current\??\.remove\(\)|\bmapInstanceRef\.current\??\.remove\(\)|\bmap\.remove\(\)|\bminimap\.remove\(\)|destroyMapboxMap\s*\()/.test(body);
      if (!releases) offenders.push(path.replace(SRC_ROOT, 'client/src'));
    }

    expect(
      offenders,
      'These construct a Mapbox map but never call map.remove(). The GL context, '
        + 'canvas and window listeners outlive the component and cannot be garbage '
        + 'collected; past ~16 contexts the browser kills the oldest and unrelated '
        + 'maps go blank.',
    ).toEqual([]);
  });

  it('every unregisterMapInstance site releases that same map right there', () => {
    // The specific regression: a cleanup that unregisters (satisfying the
    // bookkeeping) while quietly skipping the release.
    //
    // Checked per SITE, not per file. A file-wide count of ".remove()" is
    // useless here — DispatchMiniMap removes a dozen *markers* in the same
    // cleanup, which trivially satisfies any whole-file tally while the map
    // itself leaks. So: for each unregisterMapInstance(<expr>), require
    // <expr>.remove() within the same neighbourhood.
    const WINDOW = 260;
    const offenders: string[] = [];

    for (const { path, body } of mapOwningFiles()) {
      const re = /unregisterMapInstance\(\s*([A-Za-z_$][\w.$]*)\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        const expr = m[1];                       // e.g. mapRef.current
        const near = body.slice(m.index, m.index + WINDOW);
        const escaped = expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const releasesThisMap = new RegExp(`${escaped}\\??\\.remove\\(\\)`).test(near)
          || new RegExp(`destroyMapboxMap\\(\\s*${escaped}`).test(near);
        if (!releasesThisMap) {
          const line = body.slice(0, m.index).split('\n').length;
          offenders.push(`${path.replace(SRC_ROOT, 'client/src')}:${line} unregisters ${expr} without ${expr}.remove()`);
        }
      }
    }

    expect(
      offenders,
      'Unregistering only drops our bookkeeping entry. Without map.remove() the '
        + 'WebGL context, canvas and window listeners survive the component.',
    ).toEqual([]);
  });
});
