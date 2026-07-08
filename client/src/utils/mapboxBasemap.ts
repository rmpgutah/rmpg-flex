// client/src/utils/mapboxBasemap.ts
// Runtime re-skin of a stock Mapbox style into RMPG's active theme palette.
// Call on the map's `style.load` event so it re-applies after every style swap.
// Every mutation is guarded: a layer missing from a given stock style is skipped,
// never thrown — the restyler must never blank the map.
//
// Colors are read from the CSS custom properties on <html> (theme-palettes.css)
// rather than hardcoded — this used to be a fixed pure-black/gold palette (the
// GOLD constant below), independent of the app's Blue & Silver theme (2026-07-07
// UPDATE: maps now follow the active theme instead of a separate hardcoded one).
// Mapbox GL paint properties reject a literal `var(--x)` reference (only DOM CSS
// resolves those), so getThemeColor() resolves the custom property to a real
// `rgb(r g b)` string via getComputedStyle at call time instead.
//
// Deliberately reads from document.documentElement (the <html> tag, where
// theme.ts stamps theme-blue-silver/theme-dark/theme-legacy-black), NOT from
// the map's own container — some map/nav/dashcam surfaces wrap their content in
// a `.tactical-dark` class that forces the old night steel-blue palette for
// legibility over video/GPS HUDs, and reading from <html> intentionally
// bypasses that per an explicit product decision to make Blue & Silver (or
// whatever theme is active) the map's real color source, not a
// tactical-dark-only exception. Falls back to the pre-2026-07-07 black/gold
// values if a CSS variable is somehow unset (SSR, very old cached CSS).

import type mapboxgl from 'mapbox-gl';

export type BasemapVariant = 'dark' | 'satellite' | 'light';

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

/** Resolve an "R G B" triplet custom property to a Mapbox-safe `rgb(r g b)`
 *  (or `rgb(r g b / a)`) color string, reading the live theme off <html> so
 *  this follows whatever theme is active (Blue & Silver by default, or the
 *  legacy-black kill-switch) instead of being pinned to one fixed palette. */
function getThemeColorRgb(varName: string, alpha?: number): string {
  const triplet = readVar(varName) || FALLBACK_RGB[varName] || '0 0 0';
  return alpha != null ? `rgb(${triplet} / ${alpha})` : `rgb(${triplet})`;
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

function applyDark(map: mapboxgl.Map): void {
  const surfaceBase = getThemeColorRgb('--surface-base-rgb');
  const surfaceSunken = getThemeColorRgb('--surface-sunken-rgb');
  const accent = getThemeColorRgb('--brand-gold-rgb'); // "gold" token = silver under Blue & Silver
  const borderDefault = getThemeColorHex('--border-default');
  const borderSubtle = getThemeColorHex('--border-subtle');
  const textSecondary = getThemeColorHex('--text-secondary');
  const halo = getThemeColorRgb('--surface-base-rgb'); // text halo matches the map's own background

  // Background / land — theme surface-base (navy under Blue & Silver).
  setPaint(map, 'background', 'background-color', surfaceBase);
  forEachLayer(map,
    (id, type) => type === 'background' || /land|landcover|landuse|national-park|park/i.test(id),
    (id, type) => {
      if (type === 'fill') setPaint(map, id, 'fill-color', surfaceSunken);
      if (type === 'background') setPaint(map, id, 'background-color', surfaceBase);
    });

  // Water — theme surface-sunken, so it reads as a distinct, darker shade of
  // the SAME navy ramp rather than the old fixed "zero blue" near-black
  // (that choice existed specifically to avoid a blue tint under the
  // black/gold theme, which no longer applies under Blue & Silver).
  forEachLayer(map, (id) => /water|ocean|river|bathymetry/i.test(id),
    (id, type) => {
      if (type === 'fill') setPaint(map, id, 'fill-color', surfaceSunken);
      if (type === 'line') setPaint(map, id, 'line-color', surfaceSunken);
    });

  // Roads — muted, with the theme accent (silver under Blue & Silver) on
  // major arterials.
  forEachLayer(map, (id, type) => type === 'line' && /road|street|bridge|tunnel|motorway|trunk|primary|secondary/i.test(id),
    (id) => {
      if (/motorway|trunk|primary/i.test(id)) {
        setPaint(map, id, 'line-color', accent);
        setPaint(map, id, 'line-opacity', 0.55);
      } else if (/secondary|tertiary/i.test(id)) {
        setPaint(map, id, 'line-color', borderDefault);
      } else {
        setPaint(map, id, 'line-color', borderSubtle);
      }
    });

  // Admin / boundaries
  forEachLayer(map, (id, type) => type === 'line' && /admin|boundary/i.test(id),
    (id) => setPaint(map, id, 'line-color', borderSubtle));

  // Labels: accent for major, secondary-text for minor, background-matched
  // halo; hide POI noise.
  forEachLayer(map, (id, type) => type === 'symbol',
    (id) => {
      if (/poi|transit|airport|natural-point/i.test(id)) {
        setLayout(map, id, 'visibility', 'none');
        return;
      }
      setPaint(map, id, 'text-halo-color', halo);
      setPaint(map, id, 'text-halo-width', 1.2);
      if (/motorway|trunk|primary|place-(city|town)|settlement-major/i.test(id)) {
        setPaint(map, id, 'text-color', accent);
      } else {
        setPaint(map, id, 'text-color', textSecondary);
      }
    });
}

function applySatellite(map: mapboxgl.Map): void {
  const accent = getThemeColorRgb('--brand-gold-rgb');
  const surfaceBase = getThemeColorRgb('--surface-base-rgb');
  const textPrimary = getThemeColorHex('--text-primary');
  // Leave imagery; just make overlay roads/labels legible & on-brand.
  forEachLayer(map, (id, type) => type === 'line' && /road|motorway|trunk|primary/i.test(id),
    (id) => { if (/motorway|trunk|primary/i.test(id)) setPaint(map, id, 'line-color', accent); });
  forEachLayer(map, (id, type) => type === 'symbol',
    (id) => {
      setPaint(map, id, 'text-halo-color', surfaceBase);
      setPaint(map, id, 'text-halo-width', 1.4);
      setPaint(map, id, 'text-color', textPrimary);
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
    else if (variant === 'dark') applyDark(map);
    // 'light' = print path: intentionally minimal, leave stock light style as-is.
  } catch { /* never throw from a cosmetic restyle */ }
}
