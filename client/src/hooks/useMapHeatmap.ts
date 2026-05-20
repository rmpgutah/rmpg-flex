// ============================================================
// RMPG Flex — useMapHeatmap Hook
// ============================================================
// Native Mapbox GL heatmap layer for crime/incident density
// visualization. Replaces Google Maps HeatmapLayer (via the
// Visualization library).
//
// Uses Mapbox's built-in 'heatmap' layer type with
// configurable intensity, radius, and color ramp.
// ============================================================

import { useEffect, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { devLog } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export interface HeatmapPoint {
  longitude: number;
  latitude: number;
  /** Weight/intensity 0–1 (higher = hotter). Default 0.5. */
  weight?: number;
}

export interface UseMapHeatmapResult {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
  updatePoints: (pts: HeatmapPoint[]) => void;
  setIntensity: (v: number) => void;
  setRadius: (v: number) => void;
}

// ── Constants ─────────────────────────────────────────────

const HEAT_SOURCE = 'rmpg-heatmap';
const HEAT_LAYER = 'rmpg-heatmap-layer';

function heatGeoJSON(points: HeatmapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map(p => ({
      type: 'Feature' as const,
      properties: { weight: p.weight ?? 0.5 },
      geometry: { type: 'Point' as const, coordinates: [p.longitude, p.latitude] },
    })),
  };
}

// ── Hook ──────────────────────────────────────────────────

export function useMapHeatmap(map: mapboxgl.Map | null, mapLoaded: boolean): UseMapHeatmapResult {
  const [enabled, setEnabled] = useState(false);
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [intensity, setIntensity] = useState(1);
  const [radius, setRadius] = useState(20);

  useEffect(() => {
    if (!map || !mapLoaded) return;

    if (!enabled) {
      if (map.getLayer(HEAT_LAYER)) map.removeLayer(HEAT_LAYER);
      if (map.getSource(HEAT_SOURCE)) map.removeSource(HEAT_SOURCE);
      return;
    }

    if (!map.getSource(HEAT_SOURCE)) {
      map.addSource(HEAT_SOURCE, { type: 'geojson', data: heatGeoJSON(points) });

      map.addLayer({
        id: HEAT_LAYER,
        type: 'heatmap',
        source: HEAT_SOURCE,
        maxzoom: 17,
        paint: {
          // Weight from property
          'heatmap-weight': ['get', 'weight'],

          // Intensity ramps with zoom
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            0, intensity * 0.5,
            14, intensity,
          ],

          // Color ramp: transparent → blue → green → yellow → red
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.1, 'rgba(33,102,172,0.4)',
            0.3, 'rgba(103,169,207,0.6)',
            0.5, 'rgba(209,229,143,0.7)',
            0.7, 'rgba(253,219,119,0.8)',
            0.9, 'rgba(239,138,98,0.9)',
            1, 'rgba(178,24,43,1)',
          ],

          // Radius ramps with zoom
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            0, radius * 0.5,
            14, radius,
            18, radius * 2,
          ],

          // Fade out at high zoom so individual markers are visible
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            14, 0.8,
            18, 0.3,
          ],
        },
      });

      devLog('[Heatmap] Layer added with', points.length, 'points');
    }

    return () => {
      if (map.getLayer(HEAT_LAYER)) map.removeLayer(HEAT_LAYER);
      if (map.getSource(HEAT_SOURCE)) map.removeSource(HEAT_SOURCE);
    };
  }, [map, mapLoaded, enabled, points, intensity, radius]);

  // Sync data changes
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;
    const src = map.getSource(HEAT_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(heatGeoJSON(points));
  }, [map, mapLoaded, enabled, points]);

  const toggle = useCallback(() => setEnabled(v => !v), []);
  const updatePoints = useCallback((pts: HeatmapPoint[]) => setPoints(pts), []);

  return { enabled, toggle, setEnabled, updatePoints, setIntensity, setRadius };
}
