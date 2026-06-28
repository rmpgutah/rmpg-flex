// ============================================================
// RMPG Flex — useMapTraffic Hook
// ============================================================
// Toggles Mapbox's built-in real-time traffic layer on/off.
// Replaces the Google Maps TrafficLayer.
//
// Mapbox provides traffic data through the "mapbox-traffic-v1"
// tileset which is added as a vector source with color-coded
// line layers for congestion levels.
// ============================================================

import { useEffect, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { devLog } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export interface UseMapTrafficResult {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
}

// ── Constants ─────────────────────────────────────────────

const TRAFFIC_SOURCE = 'rmpg-traffic';
const TRAFFIC_LAYER = 'rmpg-traffic-flow';
const TRAFFIC_CASE = 'rmpg-traffic-case';

const CONGESTION_COLORS: Record<string, string> = {
  low: '#22c55e',
  moderate: '#f59e0b',
  heavy: '#ef4444',
  severe: '#7f1d1d',
};

// ── Hook ──────────────────────────────────────────────────

export function useMapTraffic(map: mapboxgl.Map | null, mapLoaded: boolean): UseMapTrafficResult {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!map || !mapLoaded) return;

    if (!enabled) {
      [TRAFFIC_LAYER, TRAFFIC_CASE].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(TRAFFIC_SOURCE)) map.removeSource(TRAFFIC_SOURCE);
      return;
    }

    if (!map.getSource(TRAFFIC_SOURCE)) {
      map.addSource(TRAFFIC_SOURCE, {
        type: 'vector',
        url: 'mapbox://mapbox.mapbox-traffic-v1',
      });

      // Casing (outline) for road segments
      map.addLayer({
        id: TRAFFIC_CASE,
        type: 'line',
        source: TRAFFIC_SOURCE,
        'source-layer': 'traffic',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#0a0a0a',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            10, 3,
            16, 8,
          ],
          'line-opacity': 0.6,
        },
      });

      // Traffic flow color-coded by congestion level
      map.addLayer({
        id: TRAFFIC_LAYER,
        type: 'line',
        source: TRAFFIC_SOURCE,
        'source-layer': 'traffic',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': [
            'match', ['get', 'congestion'],
            'low', CONGESTION_COLORS.low,
            'moderate', CONGESTION_COLORS.moderate,
            'heavy', CONGESTION_COLORS.heavy,
            'severe', CONGESTION_COLORS.severe,
            '#888888', // default
          ],
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            10, 1.5,
            16, 5,
          ],
          'line-opacity': 0.75,
        },
      });

      devLog('[Traffic] Traffic layer enabled');
    }

    return () => {
      [TRAFFIC_LAYER, TRAFFIC_CASE].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(TRAFFIC_SOURCE)) map.removeSource(TRAFFIC_SOURCE);
    };
  }, [map, mapLoaded, enabled]);

  const toggle = useCallback(() => setEnabled(v => !v), []);

  return { enabled, toggle, setEnabled };
}
