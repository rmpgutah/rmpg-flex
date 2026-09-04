// Speed Heatmap Overlay — grid-aggregated GPS speed density.
// Fetches /dispatch/gps/speed-heatmap and renders a native Mapbox 'heatmap'
// layer weighted by avg_speed. Distinct source/layer IDs from the crime
// heatmap (useMapHeatmap) so the two can run independently.
import { useCallback, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { hasLayer, safeRemoveLayer, safeRemoveSource, upsertGeoJsonSource } from '../utils/mapboxSafeLayer';

interface HeatmapCell {
  grid_lat: number;
  grid_lng: number;
  avg_speed: number;
  max_speed: number;
  point_count: number;
}

const SOURCE_ID = 'rmpg-speed-heatmap-source';
const LAYER_ID = 'rmpg-speed-heatmap-layer';

function toGeoJSON(cells: HeatmapCell[]): GeoJSON.FeatureCollection {
  const maxSpeed = cells.reduce((m, c) => Math.max(m, c.avg_speed), 1);
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature',
      properties: { weight: Math.min(1, c.avg_speed / maxSpeed) },
      geometry: { type: 'Point', coordinates: [c.grid_lng, c.grid_lat] },
    })),
  };
}

export function useMapboxSpeedHeatmap(map: mapboxgl.Map | null) {
  const [loading, setLoading] = useState(false);
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [error, setError] = useState<string | null>(null);

  const clear = useCallback(() => {
    if (!map) return;
    safeRemoveLayer(map, LAYER_ID);
    safeRemoveSource(map, SOURCE_ID);
  }, [map]);

  const renderOnMap = useCallback((data: HeatmapCell[], m: mapboxgl.Map) => {
    upsertGeoJsonSource(m, SOURCE_ID, toGeoJSON(data));
    if (hasLayer(m, LAYER_ID)) return;

    m.addLayer({
      id: LAYER_ID,
      type: 'heatmap',
      source: SOURCE_ID,
      maxzoom: 17,
      paint: {
        'heatmap-weight': ['get', 'weight'],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 14, 1.2],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0 0 0 / 0)',
          0.2, 'rgba(59,130,246,0.5)',
          0.5, 'rgba(234,179,8,0.7)',
          0.8, 'rgba(249,115,22,0.85)',
          1, 'rgba(239,68,68,1)',
        ],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 14, 22],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 0.3],
      },
    });
  }, []);

  const fetchHeatmap = useCallback(async (hours = 8) => {
    if (!map) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<HeatmapCell[]>(`/dispatch/gps/speed-heatmap?hours=${hours}`);
      const list = Array.isArray(data) ? data : [];
      setCells(list);
      renderOnMap(list, map);
    } catch (err) {
      console.warn('[useMapboxSpeedHeatmap] fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load speed heatmap');
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  return { cells, loading, error, fetchHeatmap, clear };
}
