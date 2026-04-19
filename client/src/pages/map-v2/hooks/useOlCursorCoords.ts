import { useEffect, useState } from 'react';
import type OlMap from 'ol/Map';
import { toLonLat } from 'ol/proj';

/**
 * Reactive cursor coordinate state for /map-v2.
 *
 * Returns the lat/lng of the current mouse position over the map, or
 * null when the cursor is outside the viewport. Throttled to ~30Hz via
 * pointermove events (OL coalesces these — no manual debouncing needed).
 */
export function useOlCursorCoords(map: OlMap | null): { lat: number; lng: number } | null {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    const onMove = (evt: any) => {
      const c = evt.coordinate;
      if (!c) { setCoords(null); return; }
      const [lng, lat] = toLonLat(c);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setCoords({ lat, lng });
      }
    };
    const onLeave = () => setCoords(null);
    map.on('pointermove', onMove);
    map.getViewport().addEventListener('mouseleave', onLeave);
    return () => {
      map.un('pointermove', onMove);
      map.getViewport().removeEventListener('mouseleave', onLeave);
    };
  }, [map]);

  return coords;
}
