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
export function whenStyleReady(map: mapboxgl.Map | null | undefined, fn: () => void): () => void {
  const noop = () => {};
  if (!map) return noop;
  if (map.isStyleLoaded()) {
    fn();
    return noop;
  }

  let fired = false;
  const handler = () => {
    fired = true;
    // Gate ONLY on teardown. Do NOT also require map.loaded(): on 'style.load'
    // the STYLE graph is ready (mutations are safe), but map.loaded() stays
    // false while tiles/sources are still streaming — so requiring it here
    // silently dropped the deferred addSource/addLayer (this is a `once`
    // listener, so it never retried) and the layer never appeared.
    // getStyle() is falsy on a removed/torn-down style — the real "don't
    // mutate" condition.
    if ((map as any)._removed || !map.getStyle()) return;
    fn();
  };
  map.once('style.load', handler);

  return () => {
    if (!fired) {
      map.off('style.load', handler);
    }
  };
}
