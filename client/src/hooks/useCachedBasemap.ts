import { useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { TileFailureTracker } from './tileFailureDetection';

/** Mapbox GL's public `.d.ts` only declares `{ error: Error }` on the map
 *  `error` event, but at runtime a source-originated error (raster/vector
 *  tile fetch failure, geojson parse failure, etc.) is fired on the Source
 *  and bubbled up via `setEventedParent`, which merges in `sourceId` and the
 *  serialized `source` definition (see mapbox-gl's `Style.addSource` —
 *  `sourceInstance.setEventedParent(this, () => ({ sourceId, source, ... }))`).
 *  Errors WITHOUT a `sourceId` (style-load failures, sprite/glyph fetch
 *  failures, WebGL issues, etc.) never carry this shape. */
interface MapErrorEventLike {
  error?: { message?: string };
  sourceId?: string;
  source?: { type?: string };
}

interface MapSourceDataEventLike {
  sourceId?: string;
  source?: { type?: string };
  isSourceLoaded?: boolean;
}

/** Only base-map tile sources (raster/vector) count toward "tiles aren't
 *  loading." A broken GeoJSON overlay (e.g. the district/beat layer itself,
 *  or any other app-added source) or a non-source style error must NOT trip
 *  the degraded-basemap fallback — that would show a misleading "live tiles
 *  unavailable" message on a safety-relevant HUD while the real basemap
 *  tiles are loading fine. */
function isBaseTileSource(source: { type?: string } | undefined, sourceId: string | undefined): boolean {
  return sourceId != null && (source?.type === 'raster' || source?.type === 'vector');
}

/** Flags the live map as "degraded" when its base-map tiles have been
 *  failing to load for several seconds — the caller is expected to show a
 *  fallback backdrop (this hook doesn't render one itself, so an existing
 *  layer/overlay can be reused rather than building a second independent
 *  rendering path). This is NOT a true offline basemap (Mapbox vector tiles
 *  aren't cacheable to disk under the current license) — it just degrades
 *  the "blank screen" case.
 *
 *  Mapbox GL only emits `error`/`sourcedata` events when a load is actually
 *  attempted. If the network hangs after a single failed attempt with no
 *  further tile requests firing, no further events arrive — so degraded
 *  state would never flip from `recordError` alone. A periodic re-check
 *  (re-evaluating `isDegraded(Date.now())` against the wall clock) is needed
 *  so the threshold is detected even without a continuous stream of events. */
export function useCachedBasemap(map: mapboxgl.Map | null) {
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    if (!map) {
      setDegraded(false);
      return;
    }

    // Fresh tracker per map instance — a rebuilt map (e.g. after WebGL
    // context recovery) must not inherit stale failure timestamps from a
    // prior map instance.
    const tracker = new TileFailureTracker();

    const recheck = () => setDegraded(tracker.isDegraded(Date.now()));

    const onError = (e: MapErrorEventLike) => {
      if (!isBaseTileSource(e.source, e.sourceId)) return;
      tracker.recordError(Date.now());
      recheck();
    };
    const onSourceData = (e: MapSourceDataEventLike) => {
      if (!e.isSourceLoaded || !isBaseTileSource(e.source, e.sourceId)) return;
      tracker.recordSuccess();
      recheck();
    };

    map.on('error', onError as unknown as (e: mapboxgl.ErrorEvent) => void);
    map.on('sourcedata', onSourceData as unknown as (e: mapboxgl.MapSourceDataEvent) => void);
    // Re-evaluate on a timer too — a single hung tile request may never fire
    // another error/sourcedata event, so without this, degraded would only
    // ever flip on a NEXT event rather than when the threshold actually elapses.
    const intervalId = window.setInterval(recheck, 1000);

    return () => {
      map.off('error', onError as unknown as (e: mapboxgl.ErrorEvent) => void);
      map.off('sourcedata', onSourceData as unknown as (e: mapboxgl.MapSourceDataEvent) => void);
      window.clearInterval(intervalId);
    };
  }, [map]);

  return { degraded };
}
