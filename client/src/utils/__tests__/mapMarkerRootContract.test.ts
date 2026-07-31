// ============================================================
// RMPG Flex — Mapbox marker ROOT-element contract (source ratchet)
// ============================================================
// Mapbox GL rewrites `element.style.transform` IN FULL on every render frame
// for the exact root node handed to `new mapboxgl.Marker({ element })`. Two
// mistakes follow from forgetting that, and both have shipped here before:
//
//   1. Assigning our own `transform` to that root — it overwrites Mapbox's
//      `translate(...)`, so the marker jumps to the map's origin until the
//      next frame snaps it back. ServeIntakeMap's hover handler did exactly
//      this (`el.style.transform = 'scale(1.2)'`), making a hovered serve pin
//      visibly fly to the corner of the map.
//   2. Putting a `transition`/`animation` on `transform` there — each frame's
//      reposition becomes an animation the marker chases, so pins lag and
//      slide behind the basemap while panning.
//
// The fix in both cases is the same and is the contract this file pins: the
// root carries position-neutral styling only, and ALL visual styling — including
// any transform we own — lives on one inner `[data-role="marker-inner"]` wrapper.
//
// This is a SOURCE scan, deliberately. jsdom has no layout engine and never
// runs Mapbox's per-frame transform writes, so a behavioural test cannot
// observe the clobber at all; the only reliable guard is "don't write the
// property." Scope is limited to files that actually construct markers, and
// the check is intentionally narrow (a literal `<root>.style.transform =`
// assignment) so it flags the real mistake without banning legitimate
// transforms on inner wrappers.

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

/** Files that build DOM elements for `new mapboxgl.Marker({ element })`. */
function markerBuildingFiles(): Array<{ path: string; body: string }> {
  return walk(SRC_ROOT)
    .map((path) => ({ path, body: readFileSync(path, 'utf8') }))
    .filter(({ body }) => body.includes('mapboxgl.Marker(') || body.includes('marker-inner'));
}

describe('mapboxgl.Marker root-element contract', () => {
  it('scans a non-trivial set of marker-building files (guards against a broken glob)', () => {
    // A silently-empty scan would make every assertion below pass vacuously.
    expect(markerBuildingFiles().length).toBeGreaterThan(5);
  });

  it('no marker builder assigns `transform` to the mapboxgl-owned root element', () => {
    // Matches `el.style.transform =` / `element.style.transform =` / `root.style.transform =`
    // — the conventional names for the node passed to `new mapboxgl.Marker`.
    // An inner wrapper (`inner.style.transform`, `badge.style.transform`) is fine
    // and is the sanctioned place for a transform we own.
    const ROOT_TRANSFORM = /\b(el|element|root)\.style\.transform\s*=/g;

    const offenders: string[] = [];
    for (const { path, body } of markerBuildingFiles()) {
      const hits = body.match(ROOT_TRANSFORM);
      if (hits) offenders.push(`${path.replace(SRC_ROOT, 'client/src')} → ${hits.join(', ')}`);
    }

    expect(
      offenders,
      'These write transform onto the element Mapbox repositions every frame, so the '
        + 'marker will jump to the map origin. Move the transform to the inner '
        + '[data-role="marker-inner"] wrapper instead.',
    ).toEqual([]);
  });

  it('no marker builder puts a transform transition on the root element', () => {
    // The root's own cssText must not carry `transition:transform`. Inner
    // wrappers legitimately do (that's the marker glide), so only flag an
    // assignment to a root-named variable.
    const offenders: string[] = [];
    for (const { path, body } of markerBuildingFiles()) {
      // Grab each `<root>.style.cssText = ...` assignment and inspect only that value.
      const assignments = body.match(/\b(el|element|root)\.style\.cssText\s*=\s*(`[^`]*`|'[^']*'|"[^"]*")/g) ?? [];
      for (const a of assignments) {
        if (/transition\s*:\s*[^;]*transform/.test(a)) {
          offenders.push(`${path.replace(SRC_ROOT, 'client/src')} → ${a.slice(0, 90)}…`);
        }
      }
    }

    expect(
      offenders,
      'A `transition:transform` on the Mapbox-owned root turns every pan/zoom frame '
        + 'into an animation the marker chases, so pins lag behind the basemap.',
    ).toEqual([]);
  });
});
