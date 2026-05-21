// Isochrone analysis — response time coverage polygons
// Shows contour polygons for 2/5/10/15 minute drive-time from a given point,
// rendered on the Mapbox GL JS map. Essential for evaluating dispatch coverage.
import { useRef, useCallback, useState, useEffect } from 'react';
import { getIsochrone, type IsochroneContour } from '../utils/mapboxServices';

const SOURCE_ID = 'rmpg-isochrone-source';
const LAYER_ID_PREFIX = 'rmpg-isochrone-layer-';
const FILL_LAYER_ID = 'rmpg-isochrone-fill';

// Minute color ramp (cool green → warm orange → hot red)
const MINUTE_COLORS: Record<number, { fill: string; outline: string }> = {
  2: { fill: 'rgba(100, 210, 100, 0.18)', outline: '#64d264' },
  5: { fill: 'rgba(180, 210, 60, 0.18)', outline: '#b4d23c' },
  10: { fill: 'rgba(240, 180, 40, 0.18)', outline: '#f0b428' },
  15: { fill: 'rgba(240, 120, 40, 0.18)', outline: '#f07828' },
  20: { fill: 'rgba(240, 60, 60, 0.15)', outline: '#f03c3c' },
};

export interface IsochroneResult {
  contours: IsochroneContour[];
  center: [number, number];
  minutes: number[];
  loading: boolean;
}

export function useMapboxIsochrone(map: mapboxgl.Map | null) {
  const [result, setResult] = useState<IsochroneResult>({
    contours: [], center: [0, 0], minutes: [], loading: false,
  });
  const activeRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearFromMap(map);
  }, [map]);

  const clearFromMap = useCallback((m: mapboxgl.Map | null) => {
    if (!m) return;
    try {
      Object.keys(MINUTE_COLORS).forEach((min) => {
        const id = LAYER_ID_PREFIX + min;
        if (m.getLayer(id)) m.removeLayer(id);
      });
      if (m.getLayer(FILL_LAYER_ID)) m.removeLayer(FILL_LAYER_ID);
      if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID);
    } catch { /* ignore cleanup errors */ }
  }, []);

  const renderOnMap = useCallback((contours: IsochroneContour[], m: mapboxgl.Map) => {
    clearFromMap(m);

    // Build a FeatureCollection with one feature per contour
    const features: GeoJSON.Feature[] = contours.map((c) => ({
      type: 'Feature' as const,
      properties: { minutes: c.minutes },
      geometry: c.geometry,
    }));

    m.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    // Fill layer (semi-transparent)
    m.addLayer({
      id: FILL_LAYER_ID,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': [
          'match', ['get', 'minutes'],
          2, MINUTE_COLORS[2].fill,
          5, MINUTE_COLORS[5].fill,
          10, MINUTE_COLORS[10].fill,
          15, MINUTE_COLORS[15].fill,
          20, MINUTE_COLORS[20].fill,
          'rgba(150,150,150,0.1)',
        ],
      },
    });

    // Outline per minute
    Object.keys(MINUTE_COLORS).forEach((min) => {
      const minutes = parseInt(min, 10);
      m.addLayer({
        id: LAYER_ID_PREFIX + min,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', ['get', 'minutes'], minutes],
        paint: {
          'line-color': MINUTE_COLORS[minutes].outline,
          'line-width': 2,
          'line-opacity': 0.7,
          'line-dasharray': minutes <= 5 ? [1] : [3, 2],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
    });
  }, [clearFromMap]);

  const fetchIsochrone = useCallback(async (
    lng: number,
    lat: number,
    minutes: number[] = [5, 10, 15],
    profile: 'driving' | 'walking' | 'cycling' = 'driving',
  ) => {
    if (!map) return;
    activeRef.current = true;
    setResult((prev) => ({ ...prev, loading: true }));

    try {
      const data = await getIsochrone(lng, lat, minutes, profile);
      const contours = data.features || [];
      if (activeRef.current && map.loaded()) {
        renderOnMap(contours, map);
      }
      setResult({ contours, center: [lng, lat], minutes, loading: false });
    } catch (err) {
      console.warn('[useMapboxIsochrone] failed:', err);
      setResult((prev) => ({ ...prev, loading: false }));
    }
  }, [map, renderOnMap]);

  const clear = useCallback(() => {
    activeRef.current = false;
    clearFromMap(map);
    setResult({ contours: [], center: [0, 0], minutes: [], loading: false });
  }, [map, clearFromMap]);

  return { result, fetchIsochrone, clear };
}
