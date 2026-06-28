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
 * Cleanup: if a component unmounts before `style.load` fires, the deferred
 * callback could fire on a torn-down map. The function returns a cleanup
 * callback that callers can store + invoke in their own useEffect cleanup.
 * As a backstop, we also auto-clean on `map` 'remove' (Mapbox public API)
 * so a destroyed map won't leak listeners even if no caller calls cleanup.
 */
export function whenStyleReady(map: mapboxgl.Map | null | undefined, fn: () => void): () => void {
  const noop = () => {};
  if (!map) return noop;
  if (map.isStyleLoaded()) {
    fn();
    return noop;
  }

  let fired = false;
  let cleaned = false;
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
  const cleanup = () => {
    if (fired || cleaned) return;
    cleaned = true;
    map.off('style.load', handler);
  };
  map.once('style.load', handler);
  // REGRESSION-GUARD: auto-cleanup when the map is destroyed. ZERO of the
  // 42 call sites store the returned cleanup callback, so without this
  // backstop every deferred whenStyleReady registration leaks a listener
  // onto the map object that never gets removed (map.once('style.load')
  // is held until the map itself is GC'd). `map.once('remove', ...)` is
  // the public Mapbox API and fires reliably when map.remove() is called.
  map.once('remove', cleanup);

  return cleanup;
}
