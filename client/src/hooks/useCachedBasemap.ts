import { useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { TileFailureTracker } from './tileFailureDetection';

/** Flags the live map as "degraded" when its tiles have been failing to load
 *  for several seconds — the caller is expected to show a fallback backdrop
 *  (this hook doesn't render one itself, so an existing layer/overlay can be
 *  reused rather than building a second independent rendering path). This is
 *  NOT a true offline basemap (Mapbox vector tiles aren't cacheable to disk
 *  under the current license) — it just degrades the "blank screen" case.
 *
 *  Mapbox GL only emits `error`/`sourcedata` events when a load is actually
 *  attempted. If the network hangs after a single failed attempt with no
 *  further tile requests firing, no further events arrive — so degraded
 *  state would never flip from `recordError` alone. A periodic re-check
 *  (re-evaluating `isDegraded(Date.now())` against the wall clock) is needed
 *  so the threshold is detected even without a continuous stream of events. */
export function useCachedBasemap(map: mapboxgl.Map | null) {
  const [degraded, setDegraded] = useState(false);
  const trackerRef = useRef(new TileFailureTracker());

  useEffect(() => {
    if (!map) {
      setDegraded(false);
      return;
    }

    const recheck = () => setDegraded(trackerRef.current.isDegraded(Date.now()));

    const onError = () => {
      trackerRef.current.recordError(Date.now());
      recheck();
    };
    const onSourceData = (e: mapboxgl.MapSourceDataEvent) => {
      if (e.isSourceLoaded) {
        trackerRef.current.recordSuccess();
        recheck();
      }
    };

    map.on('error', onError);
    map.on('sourcedata', onSourceData);
    // Re-evaluate on a timer too — a single hung tile request may never fire
    // another error/sourcedata event, so without this, degraded would only
    // ever flip on a NEXT event rather than when the threshold actually elapses.
    const intervalId = window.setInterval(recheck, 1000);

    return () => {
      map.off('error', onError);
      map.off('sourcedata', onSourceData);
      window.clearInterval(intervalId);
    };
  }, [map]);

  return { degraded };
}
