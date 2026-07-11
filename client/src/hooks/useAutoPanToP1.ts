import { useEffect, useRef } from 'react';
import type { Map } from 'mapbox-gl';
import type { ActiveCall } from '../pages/map/utils/mapConstants';

export function useAutoPanToP1(
  map: Map | null | undefined,
  calls: ActiveCall[],
  options: { enabled: boolean } = { enabled: true },
): void {
  const prevLenRef = useRef(0);
  useEffect(() => {
    if (!map || !options.enabled) return;
    const p1 = calls.find((c) => String(c.priority) === '1');
    if (!p1) return;
    if (calls.length === prevLenRef.current) return;
    prevLenRef.current = calls.length;
    if (p1.latitude && p1.longitude) {
      map.flyTo({ center: [p1.longitude, p1.latitude], zoom: 15, duration: 800 });
    }
  }, [map, calls, options.enabled]);
}
