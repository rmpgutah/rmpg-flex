// Dynamic Heatmap Overlay — call density / risk-weighted heatmap layer
// Fetches from /api/dispatch/heatmap and renders as Mapbox GL JS heatmap layer.
// Supports all/risk/type modes with configurable radius, intensity, and color scale.
import { useCallback, useState, useEffect, useRef } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';

interface HeatmapPoint {
  latitude: number;
  longitude: number;
  count: number;
  incident_types?: string;
  p1_count?: number;
  weapons_count?: number;
  dv_count?: number;
  injuries_count?: number;
  risk_weight?: number;
}

const SOURCE_ID = 'rmpg-dispatch-heatmap';
const HEATMAP_LAYER_ID = 'rmpg-dispatch-heatmap-layer';

const PRESETS: Record<string, { radius: number; intensity: number; opacity: number }> = {
  default: { radius: 25, intensity: 0.5, opacity: 0.7 },
  dense: { radius: 18, intensity: 0.7, opacity: 0.85 },
  wide: { radius: 40, intensity: 0.3, opacity: 0.5 },
};

export interface HeatmapOptions {
  days?: number;
  mode?: 'all' | 'risk' | 'type';
  typeFilter?: string;
  preset?: keyof typeof PRESETS;
  colorScheme?: 'red' | 'amber' | 'blue' | 'green';
}

const COLOR_SCHEMES: Record<string, [string, number, string, number][]> = {
  red: [
    ['rgba(33,102,172,0)', 0],
    ['rgb(103,169,207)', 0.15],
    ['rgb(209,229,240)', 0.3],
    ['rgb(253,219,199)', 0.5],
    ['rgb(239,138,98)', 0.65],
    ['rgb(178,24,43)', 0.85],
    ['rgb(103,0,13)', 1],
  ],
  amber: [
    ['rgba(0,0,0,0)', 0],
    ['rgba(255,200,100,0.2)', 0.1],
    ['rgba(255,180,50,0.5)', 0.35],
    ['rgba(240,130,20,0.7)', 0.6],
    ['rgba(200,70,0,0.9)', 0.85],
    ['rgba(120,20,0,0.95)', 1],
  ],
  blue: [
    ['rgba(0,0,0,0)', 0],
    ['rgba(0,100,200,0.2)', 0.15],
    ['rgba(0,150,255,0.5)', 0.4],
    ['rgba(0,200,255,0.7)', 0.65],
    ['rgba(100,230,255,0.85)', 0.85],
    ['rgba(200,245,255,0.95)', 1],
  ],
  green: [
    ['rgba(0,0,0,0)', 0],
    ['rgba(50,150,50,0.2)', 0.2],
    ['rgba(100,200,50,0.5)', 0.5],
    ['rgba(200,240,100,0.7)', 0.7],
    ['rgba(240,255,150,0.9)', 1],
  ],
};

export function useMapboxHeatmap(map: mapboxgl.Map | null) {
  const [loading, setLoading] = useState(false);
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [total, setTotal] = useState(0);
  const layerRef = useRef(false);

  useEffect(() => {
    return () => {
      if (!map) return;
      try {
        if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* ignore */ }
    };
  }, [map]);

  const ensureLayer = useCallback((m: mapboxgl.Map, preset: string, scheme: string) => {
    const p = PRESETS[preset] || PRESETS.default;
    const cs = COLOR_SCHEMES[scheme] || COLOR_SCHEMES.red;

    if (!m.getSource(SOURCE_ID)) {
      m.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    if (m.getLayer(HEATMAP_LAYER_ID)) m.removeLayer(HEATMAP_LAYER_ID);

    m.addLayer({
      id: HEATMAP_LAYER_ID,
      type: 'heatmap',
      source: SOURCE_ID,
      paint: {
        'heatmap-radius': p.radius,
        'heatmap-intensity': p.intensity,
        'heatmap-opacity': p.opacity,
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], ...cs.flat()] as any,
        'heatmap-weight': ['get', 'weight'],
      },
    });
    layerRef.current = true;
  }, []);

  const fetchHeatmap = useCallback(async (options: HeatmapOptions = {}) => {
    if (!map) return;
    const { days = 30, mode = 'all', typeFilter, preset = 'default', colorScheme = 'red' } = options;
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days), mode });
      if (typeFilter && mode === 'type') params.set('type', typeFilter);
      const data = await apiFetch<HeatmapPoint[]>(`/dispatch/heatmap?${params}`);
      const pts = Array.isArray(data) ? data : [];
      const totalPts = pts.reduce((s, p) => s + (p.count || 0), 0);

      setPoints(pts);
      setTotal(totalPts);

      if (map.loaded()) {
        const features: GeoJSON.Feature[] = pts.map((p) => ({
          type: 'Feature',
          properties: {
            count: p.count,
            weight: Math.log(1 + p.count) * (mode === 'risk' && p.risk_weight ? ((p.risk_weight || 0) / Math.max(1, p.count)) * p.count : p.count),
            incident_types: p.incident_types,
            p1_count: p.p1_count || 0,
            weapons_count: p.weapons_count || 0,
          },
          geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
        }));

        const src = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (src) {
          src.setData({ type: 'FeatureCollection', features });
        }
        if (!layerRef.current) {
          ensureLayer(map, preset, colorScheme);
        }
      }
    } catch (err) {
      console.warn('[useMapboxHeatmap] fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [map, ensureLayer]);

  const clear = useCallback(() => {
    if (!map) return;
    try {
      if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      layerRef.current = false;
    } catch { /* ignore */ }
    setPoints([]);
    setTotal(0);
  }, [map]);

  const toggle = useCallback((options?: HeatmapOptions) => {
    if (layerRef.current) {
      clear();
    } else {
      fetchHeatmap(options);
    }
  }, [clear, fetchHeatmap]);

  return { loading, points, total, fetchHeatmap, clear, toggle };
}
