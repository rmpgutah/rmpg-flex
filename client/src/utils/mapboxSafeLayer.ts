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
