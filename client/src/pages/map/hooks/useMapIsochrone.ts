import { useState, useCallback } from 'react';
import type mapboxgl from 'mapbox-gl';
import { mapboxIsochrone } from '../../../services/mapboxApiService';
import {
  hasLayer, safeRemoveLayer, safeRemoveSource, upsertGeoJsonSource,
} from '../../../utils/mapboxSafeLayer';
import { ISOCHRONE_COLORS, TACTICAL_TEXT_MUTED } from '../utils/tacticalPalette';

const MINUTE_CONTOURS = [5, 10, 15];

interface UseMapIsochroneOptions {
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  addToast: (msg: string, type: 'success' | 'error' | 'warning' | 'info', duration?: number) => void;
}

interface UseMapIsochroneResult {
  isochroneEnabled: boolean;
  toggleIsochrone: () => Promise<void>;
}

export function useMapIsochrone({
  map,
  mapLoaded,
  gpsLatitude,
  gpsLongitude,
  addToast,
}: UseMapIsochroneOptions): UseMapIsochroneResult {
  const [isochroneEnabled, setIsochroneEnabled] = useState(false);

  const toggleIsochrone = useCallback(async () => {
    if (!map || !mapLoaded) return;

    if (isochroneEnabled) {
      ['isochrone-fill-0', 'isochrone-fill-1', 'isochrone-fill-2',
        'isochrone-border-0', 'isochrone-border-1', 'isochrone-border-2'].forEach(id => {
        safeRemoveLayer(map, id);
      });
      safeRemoveSource(map, 'isochrone');
      setIsochroneEnabled(false);
      return;
    }

    const lng = gpsLongitude ?? map.getCenter().lng;
    const lat = gpsLatitude ?? map.getCenter().lat;

    try {
      const data = await mapboxIsochrone(lng, lat, {
        profile: 'driving',
        minutes: MINUTE_CONTOURS,
      });

      if (!data?.features) { console.error('Isochrone response missing features'); return; }
      upsertGeoJsonSource(map, 'isochrone', data as unknown as GeoJSON.FeatureCollection);

      data.features.forEach((_, idx) => {
        const fillId = `isochrone-fill-${idx}`;
        const borderId = `isochrone-border-${idx}`;
        const contourMin = (idx + 1) * 5;
        if (!hasLayer(map, fillId)) {
          map.addLayer({
            id: fillId,
            type: 'fill',
            source: 'isochrone',
            paint: { 'fill-color': ISOCHRONE_COLORS[idx] ?? TACTICAL_TEXT_MUTED, 'fill-opacity': 0.1 },
            filter: ['==', ['get', 'contour'], contourMin],
          });
        }
        if (!hasLayer(map, borderId)) {
          map.addLayer({
            id: borderId,
            type: 'line',
            source: 'isochrone',
            paint: {
              'line-color': ISOCHRONE_COLORS[idx] ?? TACTICAL_TEXT_MUTED,
              'line-width': 1.5,
              'line-opacity': 0.6,
            },
            filter: ['==', ['get', 'contour'], contourMin],
          });
        }
      });

      setIsochroneEnabled(true);
      addToast('Response time zones: 5/10/15 min driving', 'info');
    } catch {
      addToast('Failed to load isochrone data', 'error');
    }
  }, [map, mapLoaded, isochroneEnabled, gpsLatitude, gpsLongitude, addToast]);

  return { isochroneEnabled, toggleIsochrone };
}
