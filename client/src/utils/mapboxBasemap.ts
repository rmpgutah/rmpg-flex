// client/src/utils/mapboxBasemap.ts
// Runtime re-skin of a stock Mapbox style into RMPG's FIXED map palette.
// Call on the map's `style.load` event so it re-applies after every style swap.
// Every mutation is guarded: a layer missing from a given stock style is skipped,
// never thrown — the restyler must never blank the map an operator depends on.
//
// PALETTE IS FIXED, NOT THEME-DERIVED (2026-07-24 decision). Every variant —
// dark, tactical-dark, legacy-black, day — renders the same Blue/Silver/Gold so
// map appearance is predictable for operators and a future app-theme change
// cannot silently degrade map legibility.
//
// This SUPERSEDES the 2026-07-07 decision that maps follow the active theme via
// getComputedStyle on <html>. That approach also meant the map's accent tracked
// --brand-gold, which resolves to SILVER under Blue & Silver — so the map had no
// gold at all. Gold is now explicit and unconditional.
//
// Assignment: Blue = land/water/background. Gold = major arterials
// (motorway/trunk/primary) and major place labels (city/town/settlement-major).
// Silver = secondary/minor roads, admin boundaries, and all minor labels.
//
// Mapbox GL's style-spec color parser accepts hex and the legacy comma-separated
// rgb()/rgba() form only. The modern space-separated CSS4 form that Tailwind's
// rgb(var(--x)/<alpha>) tokens use fails with "color expected" and blanks the map.

import type mapboxgl from 'mapbox-gl';

export type BasemapVariant = 'dark' | 'satellite' | 'light' | 'print';

// "R G B" triplet custom properties (Tailwind's rgb(var(--x)/<alpha>) form) —
// used where opacity control matters (background/water fills).
const FALLBACK_RGB: Record<string, string> = {
  '--surface-base-rgb': '0 0 0',
  '--surface-sunken-rgb': '5 6 8',
  '--brand-gold-rgb': '212 160 23', // #d4a017
};
// Plain hex custom properties — Mapbox paint accepts hex directly, no need
// to round-trip through rgb().
const FALLBACK_HEX: Record<string, string> = {
  '--border-default': '#262626',
  '--border-subtle': '#1e2b3a',
  '--text-primary': '#e5e7eb',
  '--text-secondary': '#888888',
};

function readVar(varName: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  } catch { return ''; }
}

/** Resolve an "R G B" triplet custom property to a Mapbox-safe `rgb(r, g, b)`
 *  (or `rgba(r, g, b, a)`) color string, reading the live theme off <html> so
 *  this follows whatever theme is active (Blue & Silver by default, or the
 *  legacy-black kill-switch) instead of being pinned to one fixed palette.
 *  Mapbox GL's style-spec color parser only accepts the legacy comma-separated
 *  `rgb(r,g,b)`/`rgba(r,g,b,a)` syntax — the modern space-separated CSS4 form
 *  (`rgb(r g b)`, which Tailwind's `rgb(var(--x)/<alpha-value>)` tokens use)
 *  fails with "color expected" and blanks the map. */
export function getThemeColorRgb(varName: string, alpha?: number): string {
  const triplet = readVar(varName) || FALLBACK_RGB[varName] || '0 0 0';
  const parts = triplet.split(/\s+/).join(', ');
  return alpha != null ? `rgba(${parts}, ${alpha})` : `rgb(${parts})`;
}

/** Resolve a plain-hex theme custom property, same <html>-sourced approach
 *  as getThemeColorRgb but for tokens with no "-rgb" triplet variant. */
function getThemeColorHex(varName: string): string {
  return readVar(varName) || FALLBACK_HEX[varName] || '#888888';
}

// Dev-only warn keeps the "never throw" contract intact for production while
// surfacing a real signal when the auditor wants to know why a layer didn't
// take a paint/layout property (silent swallowing previously hid real bugs).
function isDev(): boolean {
  try { return !!(import.meta as any).env?.DEV; } catch { return false; }
}

function setPaint(map: mapboxgl.Map, id: string, prop: string, value: unknown): void {
  try {
    if (map.getLayer(id)) map.setPaintProperty(id, prop as never, value as never);
  } catch (err) {
    if (isDev()) console.warn('[basemap] setPaint failed', { id, prop, err });
  }
}

function setLayout(map: mapboxgl.Map, id: string, prop: string, value: unknown): void {
  try {
    if (map.getLayer(id)) map.setLayoutProperty(id, prop as never, value as never);
  } catch (err) {
    if (isDev()) console.warn('[basemap] setLayout failed', { id, prop, err });
  }
}

/** Apply theme to layers matched by predicate across all style layers. */
function forEachLayer(
  map: mapboxgl.Map,
  match: (id: string, type: string) => boolean,
  apply: (id: string, type: string) => void,
): void {
  let layers: mapboxgl.AnyLayer[] = [];
  try {
    layers = (map.getStyle()?.layers ?? []) as mapboxgl.AnyLayer[];
  } catch { return; }
  for (const layer of layers) {
    const id = layer.id;
    const type = (layer as { type?: string }).type ?? '';
    try { if (match(id, type)) apply(id, type); } catch { /* skip */ }
  }
}

/** Fixed map palette. Literal values by design — see the header note. */
export const MAP_PALETTE = Object.freeze({
  land: '#22405f',        // navy base
  water: '#142840',       // darker navy step
  // GOLD, split by WCAG role. Arterials are LINES (graphical objects, 3:1 per
  // 1.4.11) so they take the deep brass, which measures 3.63 on navy. Major
  // place labels are TEXT (4.5:1 per 1.4.3) so they take the lighter 300-step
  // gold, which measures 4.63+. Do not unify these two on #b8912f — that would
  // put unreadable text on the map.
  arterial: '#b8912f',    // GOLD (deep)  — motorway / trunk / primary LINES
  labelMajor: '#d9bd72',  // GOLD (light) — city / town / settlement-major TEXT
  road: '#c3ccd6',        // silver — secondary / tertiary
  roadMinor: '#7c8b9e',   // dim silver — residential / service
  boundary: '#46688c',    // subtle navy-silver border
  labelMinor: '#a0adbd',  // silver — everything else
  halo: '#142840',        // halo matches the map's own darkest surface
});

const ARTERIAL_RE = /motorway|trunk|primary/i;
const MAJOR_LABEL_RE = /place-(city|town)|settlement-major/i;
const ROAD_RE = /road|street|bridge|tunnel|motorway|trunk|primary|secondary|tertiary/i;
const MID_ROAD_RE = /secondary|tertiary/i;
const LAND_RE = /land|landcover|landuse|national-park|park/i;
const WATER_RE = /water|ocean|river|bathymetry/i;
// airport excluded: airports are key CAD/dispatch response locations and their
// labels must remain visible on the tactical map.
const NOISE_LABEL_RE = /poi|transit|natural-point/i;

export function isArterialLayer(id: string): boolean {
  return ARTERIAL_RE.test(id);
}

export function isMajorLabelLayer(id: string): boolean {
  return MAJOR_LABEL_RE.test(id);
}

function applyDark(map: mapboxgl.Map): void {
  const P = MAP_PALETTE;

  setPaint(map, 'background', 'background-color', P.land);
  forEachLayer(map,
    (id, type) => type === 'background' || LAND_RE.test(id),
    (id, type) => {
      if (type === 'fill') setPaint(map, id, 'fill-color', P.land);
      if (type === 'background') setPaint(map, id, 'background-color', P.land);
    });

  forEachLayer(map, (id) => WATER_RE.test(id),
    (id, type) => {
      if (type === 'fill') setPaint(map, id, 'fill-color', P.water);
      if (type === 'line') setPaint(map, id, 'line-color', P.water);
    });

  // Roads: gold arterials carry the wayfinding spine, silver steps down.
  forEachLayer(map, (id, type) => type === 'line' && ROAD_RE.test(id),
    (id) => {
      if (isArterialLayer(id)) {
        setPaint(map, id, 'line-color', P.arterial);
        setPaint(map, id, 'line-opacity', 0.85);
      } else if (MID_ROAD_RE.test(id)) {
        setPaint(map, id, 'line-color', P.road);
        setPaint(map, id, 'line-opacity', 0.55);
      } else {
        setPaint(map, id, 'line-color', P.roadMinor);
        setPaint(map, id, 'line-opacity', 0.45);
      }
    });

  forEachLayer(map, (id, type) => type === 'line' && /admin|boundary/i.test(id),
    (id) => setPaint(map, id, 'line-color', P.boundary));

  forEachLayer(map, (id, type) => type === 'symbol',
    (id) => {
      if (NOISE_LABEL_RE.test(id)) {
        setLayout(map, id, 'visibility', 'none');
        return;
      }
      setPaint(map, id, 'text-halo-color', P.halo);
      setPaint(map, id, 'text-halo-width', 1.2);
      setPaint(map, id, 'text-color',
        isArterialLayer(id) || isMajorLabelLayer(id) ? P.labelMajor : P.labelMinor);
    });
}

function applySatellite(map: mapboxgl.Map): void {
  const P = MAP_PALETTE;
  // Imagery is left alone; only the overlay roads/labels are made legible.
  forEachLayer(map, (id, type) => type === 'line' && ROAD_RE.test(id),
    (id) => { if (isArterialLayer(id)) setPaint(map, id, 'line-color', P.arterial); });
  forEachLayer(map, (id, type) => type === 'symbol',
    (id) => {
      setPaint(map, id, 'text-halo-color', P.halo);
      setPaint(map, id, 'text-halo-width', 1.4);
      setPaint(map, id, 'text-color',
        isMajorLabelLayer(id) ? P.labelMajor : P.labelMinor);
    });
}

/** Re-skin the loaded style. Safe to call repeatedly and on any stock style. */
export function applyRmpgBasemap(
  map: mapboxgl.Map | null | undefined,
  opts?: { variant?: BasemapVariant },
): void {
  if (!map) return;
  const variant = opts?.variant ?? 'dark';
  try {
    if (variant === 'satellite') applySatellite(map);
    else if (variant === 'print') { /* leave stock light style for print output */ }
    else if (variant === 'light') { /* leave stock light style; dark restyle would invert legibility */ }
    else applyDark(map);
  } catch { /* never throw from a cosmetic restyle */ }
}
