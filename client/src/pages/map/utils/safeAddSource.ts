import type mapboxgl from 'mapbox-gl';

/**
 * Mapbox throws "Style is not done loading" if any source/layer mutation runs
 * before `map.isStyleLoaded()` becomes true. Initial paint and effects that
 * fire on mount can race the basemap's first `style.load` event — observed in
 * prod under slower edges and larger client bundles.
 *
 * Usage: wrap any block that performs `addSource` / `addLayer` /
 * `map.on('click', layerId, ...)` in a single callback.
 *
 * Reload semantics are preserved: hooks that call `getSource(id)?.setData(...)`
 * before falling back to addSource are still safe — `setData()` doesn't touch
 * the style graph and never throws this error. Only the first-time add path
 * needs to be guarded.
 *
 * Cleanup-race handling: if a component unmounts (React strict-mode double
 * mount, fast navigation) between deferral and `style.load` firing, the
 * deferred callback bails on the `map.getStyle()` null check rather than
 * mutating a torn-down style graph.
 */
export function whenStyleReady(map: mapboxgl.Map | null | undefined, fn: () => void): void {
  if (!map) return;
  if (map.isStyleLoaded()) {
    fn();
    return;
  }
  map.once('style.load', () => {
    if (!map.getStyle()) return;
    fn();
  });
}
