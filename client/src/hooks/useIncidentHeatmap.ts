// ============================================================
// RMPG Flex — useIncidentHeatmap Hook
// ============================================================
// Incident-density heatmap sourced from the dispatch geography
// endpoint (/api/dispatch/geography/incident-heatmap?hours=24).
// Uses Mapbox's built-in 'heatmap' layer type (same paint spec as
// useMapHeatmap, distinct source/layer IDs).
// ============================================================

import { useEffect, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { hasSource, safeRemoveLayer, safeRemoveSource, getSourceSafe } from '../utils/mapboxSafeLayer';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';

const INC_SOURCE = 'rmpg-incident-heatmap';
const INC_LAYER = 'incident-heatmap';

export interface UseIncidentHeatmapResult {
  enabled: boolean;
  loading: boolean;
  error: string | null;
  toggle: () => void;
}

interface HeatmapPoint {
  latitude: number;
  longitude: number;
  weight?: number;
  incident_type?: string;
}

interface HeatmapResponse {
  hours: number;
  count: number;
  points: HeatmapPoint[];
}

function toGeoJSON(rows: HeatmapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature' as const,
      // Server weights are priority-based 1–3; normalize to 0–1 for the paint spec.
      properties: { weight: Math.min(1, (r.weight ?? 1) / 3) },
      geometry: { type: 'Point' as const, coordinates: [r.longitude, r.latitude] },
    })),
  };
}

export function useIncidentHeatmap(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  hours = 24,
): UseIncidentHeatmapResult {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<HeatmapPoint[]>([]);

  // Fetch data when enabled
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<HeatmapResponse>(
      `/dispatch/geography/incident-heatmap?hours=${hours}`,
    )
      .then((data) => {
        if (cancelled) return;
        // Endpoint returns an envelope: { hours, count, points: [...] }.
        setRows(Array.isArray(data?.points) ? data.points : []);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message ?? 'Failed to load incident heatmap');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [enabled, hours]);

  // Add/remove map layer
  useEffect(() => {
    if (!map || !mapLoaded) return;
    if (!enabled) {
      safeRemoveLayer(map, INC_LAYER);
      safeRemoveSource(map, INC_SOURCE);
      return;
    }

    whenStyleReady(map, () => {
      if (!hasSource(map, INC_SOURCE)) {
        map.addSource(INC_SOURCE, { type: 'geojson', data: toGeoJSON(rows) });
        map.addLayer({
          id: INC_LAYER,
          type: 'heatmap',
          source: INC_SOURCE,
          maxzoom: 17,
          paint: {
            'heatmap-weight': ['get', 'weight'],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 14, 1],
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
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 10, 14, 20, 18, 40],
            'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 0.3],
          },
        });
      }
    });

    return () => {
      safeRemoveLayer(map, INC_LAYER);
      safeRemoveSource(map, INC_SOURCE);
    };
  }, [map, mapLoaded, enabled, rows]);

  // Sync data updates
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;
    const src = getSourceSafe<mapboxgl.GeoJSONSource>(map, INC_SOURCE);
    if (src) src.setData(toGeoJSON(rows));
  }, [map, mapLoaded, enabled, rows]);

  const toggle = useCallback(() => setEnabled((v) => !v), []);

  return { enabled, loading, error, toggle };
}
