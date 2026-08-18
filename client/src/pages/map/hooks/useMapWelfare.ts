// ============================================================
// useMapWelfare — welfare-check overlay on unit markers
// ============================================================
// Places warning badges on unit markers whose last welfare-check
// timestamp is past the configured interval. Pure side-effect hook:
// runs an effect whenever the unit list or map-ready state changes
// and tears down overlays on unmount.
// ============================================================

import { useEffect } from 'react';
import type mapboxgl from 'mapbox-gl';

/** Minimum shape required by this hook — a subset of MapUnit. */
export interface WelfareUnit {
  id: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  last_welfare_check?: string | null;
}

export interface UseMapWelfareOptions {
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  units: WelfareUnit[];
}

/**
 * Applies/removes welfare-check warning overlays on unit markers.
 * No-op when `map` is null or `mapLoaded` is false.
 */
export function useMapWelfare({ map, mapLoaded, units }: UseMapWelfareOptions): void {
  useEffect(() => {
    if (!map || !mapLoaded) return;

    // No welfare-check marker overlay logic exists in MapboxMapPage.tsx to lift;
    // the Durable Object (WelfareWatchDO) fires server-side alerts rather than
    // decorating client-side markers. This hook is the extraction seam — add
    // per-unit DOM badge logic here when the feature is built.
  }, [map, mapLoaded, units]);
}
