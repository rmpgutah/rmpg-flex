// Historical Call Overlay — past dispatch call locations with time filters
// Fetches from /api/dispatch/history-map and renders as color-coded dots on the map.
// Essential for identifying call patterns, repeat locations, and response patterns.
import { useCallback, useState, useRef } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';

interface HistoryCall {
  id: number;
  call_number: string;
  incident_type: string;
  priority: string;
  status: string;
  disposition: string | null;
  location_address: string;
  latitude: number;
  longitude: number;
  created_at: string;
  response_time_min: number | null;
}

const CIRCLE_SOURCE_ID = 'rmpg-history-calls-source';
const CIRCLE_LAYER_ID = 'rmpg-history-calls-layer';
const LABEL_SOURCE_ID = 'rmpg-history-labels-source';
const LABEL_LAYER_ID = 'rmpg-history-labels-layer';

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#f03c3c',
  P2: '#f0b428',
  P3: '#64d264',
  P4: '#888888',
};

export interface HistoryOptions {
  days?: number;
  status?: string[];
  types?: string[];
  priority?: string[];
  limit?: number;
  maxZoomLabels?: number;
}

export function useMapboxHistoryCalls(map: mapboxgl.Map | null) {
  const [calls, setCalls] = useState<HistoryCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const visibleRef = useRef(false);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    visibleRef.current = false;
    try {
      [CIRCLE_LAYER_ID, LABEL_LAYER_ID].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      [CIRCLE_SOURCE_ID, LABEL_SOURCE_ID].forEach((id) => {
        if (map.getSource(id)) map.removeSource(id);
      });
    } catch { /* ignore */ }
  }, [map]);

  const renderOnMap = useCallback((historyCalls: HistoryCall[], m: mapboxgl.Map) => {
    clearFromMap();
    visibleRef.current = true;

    const features: GeoJSON.Feature[] = historyCalls.map((c) => {
      const ageHours = (Date.now() - new Date(c.created_at).getTime()) / 3600000;
      return {
        type: 'Feature',
        properties: {
          call_number: c.call_number,
          incident_type: c.incident_type,
          priority: c.priority,
          status: c.status,
          address: c.location_address,
          response_time: c.response_time_min,
          age_hours: Math.round(ageHours),
          priorityColor: PRIORITY_COLORS[c.priority] || '#888888',
        },
        geometry: { type: 'Point', coordinates: [c.longitude, c.latitude] },
      };
    });

    // Circle layer — size based on priority, opacity based on recency
    m.addSource(CIRCLE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    m.addLayer({
      id: CIRCLE_LAYER_ID,
      type: 'circle',
      source: CIRCLE_SOURCE_ID,
      paint: {
        'circle-radius': [
          'match', ['get', 'priority'],
          'P1', 5, 'P2', 4, 'P3', 3, 2.5,
        ],
        'circle-color': ['get', 'priorityColor'],
        'circle-opacity': ['interpolate', ['linear'], ['get', 'age_hours'],
          0, 0.8, 24, 0.6, 72, 0.4, 168, 0.25, 720, 0.12,
        ],
        'circle-stroke-color': '#0a0a0a',
        'circle-stroke-width': 1,
      },
    });
  }, [clearFromMap]);

  const fetchHistory = useCallback(async (options: HistoryOptions = {}) => {
    if (!map) return;
    const { days = 30, status, types, priority, limit = 5000 } = options;
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days), limit: String(limit) });
      if (status?.length) params.set('status', status.join(','));
      if (types?.length) params.set('types', types.join(','));
      if (priority?.length) params.set('priority', priority.join(','));

      const data = await apiFetch<HistoryCall[]>(`/dispatch/history-map?${params}`);
      const calls = Array.isArray(data) ? data : [];
      setCalls(calls);
      setTotal(calls.length);

      if (map.loaded()) {
        renderOnMap(calls, map);
      }
    } catch (err) {
      console.warn('[useMapboxHistoryCalls] fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  const clear = useCallback(() => {
    clearFromMap();
    setCalls([]);
    setTotal(0);
  }, [clearFromMap]);

  return { calls, total, loading, fetchHistory, clear };
}
