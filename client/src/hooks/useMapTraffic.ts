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

import { useEffect, useCallback, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { devLog } from '../utils/devLog';
import { hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';

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
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const ensureLayer = useCallback(() => {
    if (!map || hasSource(map, TRAFFIC_SOURCE)) return;

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
  }, [map]);

  const removeLayer = useCallback(() => {
    if (!map) return;
    [TRAFFIC_LAYER, TRAFFIC_CASE].forEach(id => {
      safeRemoveLayer(map, id);
    });
    safeRemoveSource(map, TRAFFIC_SOURCE);
  }, [map]);

  useEffect(() => {
    if (!map || !mapLoaded) return;

    if (!enabled) {
      removeLayer();
      return;
    }

    ensureLayer();

    return () => {
      removeLayer();
    };
  }, [map, mapLoaded, enabled, ensureLayer, removeLayer]);

  // A basemap style swap (e.g. NavMapView's manual `map.setStyle()` path)
  // wipes all custom sources/layers but does NOT reset `mapLoaded` the way
  // a full map recreation does (that's how the main Map page picks up
  // style swaps for free). Re-assert the layer on every style reload so
  // the toggle stays honest about what's actually rendered.
  useEffect(() => {
    if (!map) return;
    const onStyleLoad = () => {
      if (enabledRef.current) ensureLayer();
    };
    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, [map, ensureLayer]);

  const toggle = useCallback(() => setEnabled(v => !v), []);

  return { enabled, toggle, setEnabled };
}
