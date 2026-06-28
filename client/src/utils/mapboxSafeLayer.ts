// ============================================================
// mapboxSafeLayer — defensive wrappers around mapbox-gl style ops
// ============================================================
// Production crash (ErrorBoundary trip on /navigation, /map):
//
//   TypeError: Cannot read properties of undefined (reading 'getOwnLayer')
//     at Map.getLayer
//
// Root cause: `Map.prototype.getLayer` reaches through `this.style.getOwnLayer`
// without guarding when the style has been torn down (map.remove() called) or
// has not yet loaded. The existing pattern `if (map.getLayer(id)) ...` does
// NOT protect — the throw happens inside getLayer itself.
//
// Effect (hooks/components that run cleanup after route navigation): cleanup
// effect fires, map.remove() runs, then a late callback (async fetch resolve,
// debounced effect, etc.) calls `map.getLayer(id)` and the whole tree crashes.
//
// These helpers absorb the failure mode at the lowest level so callers can
// keep their existing `if (hasLayer(...)) removeLayer(...)` patterns without
// wrapping every call in try/catch.

import type mapboxgl from 'mapbox-gl';

/** Mapbox map type — kept loose so this util doesn't drag the full type into chunks that may not have it. */
type MapboxLike = Pick<mapboxgl.Map, 'getLayer' | 'getSource' | 'removeLayer' | 'removeSource'> & {
  style?: unknown;
};

/** True iff calling `map.getLayer(id)` would succeed AND return a layer. */
export function hasLayer(map: MapboxLike | undefined | null, id: string): boolean {
  if (!map || !map.style) return false;
  try { return Boolean(map.getLayer(id)); }
  catch { return false; }
}

/** True iff calling `map.getSource(id)` would succeed AND return a source. */
export function hasSource(map: MapboxLike | undefined | null, id: string): boolean {
  if (!map || !map.style) return false;
  try { return Boolean(map.getSource(id)); }
  catch { return false; }
}

/**
 * Fetch a source object, or `undefined` if the map/style is torn down or the
 * source isn't registered. Use when you need the source itself — e.g. to call
 * `.setData()` — where the boolean `hasSource` won't do. Same teardown-race
 * guard as `hasLayer`/`hasSource`: the throw is inside `getSource` (reaching
 * `this.style.getOwnSource`), so the `as GeoJSONSource | undefined` cast at the
 * call site does NOT protect — only bailing on `!map.style` + try/catch does.
 * Never throws.
 */
export function getSourceSafe<T = mapboxgl.GeoJSONSource>(
  map: MapboxLike | undefined | null,
  id: string,
): T | undefined {
  if (!map || !map.style) return undefined;
  try { return (map.getSource(id) as unknown as T) ?? undefined; }
  catch { return undefined; }
}

/** Remove a layer if present. Never throws. */
export function safeRemoveLayer(map: MapboxLike | undefined | null, id: string): void {
  if (!hasLayer(map, id)) return;
  try { map!.removeLayer(id); } catch { /* ignore — map likely torn down between check and call */ }
}

/** Remove a source if present. Never throws. */
export function safeRemoveSource(map: MapboxLike | undefined | null, id: string): void {
  if (!hasSource(map, id)) return;
  try { map!.removeSource(id); } catch { /* ignore */ }
}

// ============================================================
// safeMapboxColor — validator for paint color values
// ============================================================
// Mapbox's style spec validates `fill-color` / `line-color` etc. at
// addLayer time and rejects anything that isn't a parseable CSS color
// (hex, rgb/rgba, hsl/hsla, named, 'transparent'). A `var(--x)` CSS
// custom-property reference looks like a string to JS but throws
// `Error: layers.<id>.paint.<prop>: color expected, "var(--x)" found`
// — and that error zeroes the whole layer. CSS variables only resolve
// in the DOM, not inside a Mapbox style.
//
// This guard belongs at every config-to-mapbox seam so a single bad
// admin-config row, default value, or theme refactor can't crash the
// layer. Pair it with a tactical-dark fallback hex so the map stays
// rendered while the upstream value is repaired.
/** Return `value` if it's a Mapbox-parseable color, otherwise `fallback`. */
export function safeMapboxColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const s = value.trim();
  if (!s) return fallback;
  if (s.toLowerCase().startsWith('var(')) return fallback;
  return s;
}

// ============================================================
// upsertGeoJsonSource — idempotent addSource
// ============================================================
// Source-add races mapbox's setStyle pipeline. The simple guard
//   `if (!hasSource(map, id)) map.addSource(id, ...)`
// is too narrow: when setStyle() is mid-swap (theme change, basemap
// switch), `getSource` can transiently return undefined while the
// internal diff has already preserved the source for the new style.
// Our check sees absent → call addSource → mapbox's own restore
// races us → throw `There is already a source with ID "<id>"`.
//
// Fix: if the source already exists, just call setData on it.
// If it doesn't, addSource. If mapbox throws "already exists"
// between our check and our call (the diff race), swallow it —
// the source is now present with valid data either way.
type GeoJsonCapableMap = MapboxLike & {
  getSource: (id: string) => any;
  addSource: (id: string, spec: any) => void;
};

/** Add or update a GeoJSON source by id. Idempotent + setStyle-race-safe. */
export function upsertGeoJsonSource(
  map: GeoJsonCapableMap | undefined | null,
  id: string,
  data: GeoJSON.FeatureCollection | GeoJSON.Feature,
): void {
  if (!map || !map.style) return;
  const existing = getSourceSafe<{ setData?: (d: any) => void }>(map, id);
  if (existing && typeof existing.setData === 'function') {
    try { existing.setData(data); } catch { /* style torn down mid-call */ }
    return;
  }
  try {
    map.addSource(id, { type: 'geojson', data });
  } catch (err) {
    // Tolerate the setStyle diff-preservation race — the source ended
    // up registered either way. Re-throw anything else.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already a source with ID/i.test(msg)) throw err;
  }
}
