/**
 * useMapProjection — Mapbox GL JS projection/globe control.
 *
 * Toggle between Mercator (flat), Globe (3D sphere), and other
 * projections supported by Mapbox GL JS v3. Replaces Google Maps
 * globe view toggle.
 */

import { useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';

export type MapProjection = 'mercator' | 'globe' | 'equalEarth' | 'naturalEarth' | 'winkelTripel' | 'lambertConformalConic';

const PROJECTION_LABELS: Record<MapProjection, string> = {
  mercator: 'Mercator (Flat)',
  globe: 'Globe (3D)',
  equalEarth: 'Equal Earth',
  naturalEarth: 'Natural Earth',
  winkelTripel: 'Winkel Tripel',
  lambertConformalConic: 'Lambert Conic',
};

export function useMapProjection(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
) {
  const [projection, setProjectionState] = useState<MapProjection>('mercator');

  const setProjection = useCallback((proj: MapProjection) => {
    if (!map || !mapLoaded) return;
    try {
      map.setProjection(proj as any);
      setProjectionState(proj);

      // Add fog/atmosphere for globe view
      if (proj === 'globe') {
        map.setFog({
          color: '#0a0a0a',
          'high-color': '#1a1a2e',
          'horizon-blend': 0.08,
          'space-color': '#000000',
          'star-intensity': 0.4,
        });
      } else {
        map.setFog(null as any);
      }
    } catch (err) {
      console.warn('[MapProjection] failed to set projection:', err);
    }
  }, [map, mapLoaded]);

  const cycle = useCallback(() => {
    const projections: MapProjection[] = ['mercator', 'globe', 'equalEarth', 'naturalEarth'];
    const idx = projections.indexOf(projection);
    const next = projections[(idx + 1) % projections.length];
    setProjection(next);
  }, [projection, setProjection]);

  return {
    projection,
    setProjection,
    cycle,
    projections: Object.keys(PROJECTION_LABELS) as MapProjection[],
    labels: PROJECTION_LABELS,
  };
}
