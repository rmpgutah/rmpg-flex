// Historical Call Overlay — past dispatch call locations with time filters
// Fetches from /api/dispatch/history-map and renders as color-coded dots on the map.
// Essential for identifying call patterns, repeat locations, and response patterns.
import { useCallback, useState, useRef } from 'react';
import { parseTimestamp, formatDateTime } from '../utils/dateUtils';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { buildDetailPopupHtml } from '../pages/map/utils/mapMarkers';
import { formatIncidentType } from '../utils/caseNumbers';
import { formatEnumValue } from '../utils/formatters';
import { priorityHex } from '../utils/statusColors';

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
  const [error, setError] = useState<string | null>(null);
  const visibleRef = useRef(false);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    visibleRef.current = false;
    popupRef.current?.remove();
    popupRef.current = null;
    try {
      [CIRCLE_LAYER_ID, LABEL_LAYER_ID].forEach((id) => {
        safeRemoveLayer(map, id);
      });
      [CIRCLE_SOURCE_ID, LABEL_SOURCE_ID].forEach((id) => {
        safeRemoveSource(map, id);
      });
    } catch { /* ignore */ }
  }, [map]);

  const renderOnMap = useCallback((historyCalls: HistoryCall[], m: mapboxgl.Map) => {
    clearFromMap();
    visibleRef.current = true;

    const features: GeoJSON.Feature[] = historyCalls.map((c) => {
      const ageHours = (Date.now() - parseTimestamp(c.created_at).getTime()) / 3600000;
      return {
        type: 'Feature',
        properties: {
          call_number: c.call_number,
          incident_type: c.incident_type,
          priority: c.priority,
          status: c.status,
          disposition: c.disposition,
          address: c.location_address,
          response_time: c.response_time_min,
          created_at: c.created_at,
          age_hours: Math.round(ageHours),
          priorityColor: priorityHex(c.priority),
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
          // Tolerant of both key shapes ('P1' and bare '1') — see
          // priorityHex() in statusColors.ts. 'circle-color' above already
          // resolves through priorityHex(c.priority), so this match must
          // agree with it on shape or a call can render one priority's color
          // at another priority's radius.
          'match', ['get', 'priority'],
          ['P1', '1'], 5, ['P2', '2'], 4, ['P3', '3'], 3, 2.5,
        ],
        'circle-color': ['get', 'priorityColor'],
        'circle-opacity': ['interpolate', ['linear'], ['get', 'age_hours'],
          0, 0.8, 24, 0.6, 72, 0.4, 168, 0.25, 720, 0.12,
        ],
        'circle-stroke-color': '#0a0a0a',
        'circle-stroke-width': 1,
      },
    });

    m.on('click', CIRCLE_LAYER_ID, (e) => {
      const f = e.features?.[0];
      if (!f || f.geometry.type !== 'Point') return;
      const p = f.properties || {};
      popupRef.current?.remove();
      popupRef.current = new mapboxgl.Popup({ offset: 8, closeButton: true, className: 'mapbox-popup-dark' })
        .setLngLat(f.geometry.coordinates as [number, number])
        .setHTML(buildDetailPopupHtml(String(p.call_number || 'Historical Call'), [
          ['Type', p.incident_type ? formatIncidentType(p.incident_type) : null],
          ['Priority', p.priority],
          ['Status', p.status ? formatEnumValue(p.status) : null],
          ['Disposition', p.disposition],
          ['Address', p.address],
          ['Response Time', p.response_time != null ? `${p.response_time} min` : null],
          ['Occurred', p.created_at ? formatDateTime(p.created_at) : null],
        ]))
        .addTo(m);
    });
    m.on('mouseenter', CIRCLE_LAYER_ID, () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', CIRCLE_LAYER_ID, () => { m.getCanvas().style.cursor = ''; });
  }, [clearFromMap]);

  const fetchHistory = useCallback(async (options: HistoryOptions = {}) => {
    if (!map) return;
    const { days = 30, status, types, priority, limit = 5000 } = options;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days), limit: String(limit) });
      if (status?.length) params.set('status', status.join(','));
      if (types?.length) params.set('types', types.join(','));
      if (priority?.length) params.set('priority', priority.join(','));

      const data = await apiFetch<HistoryCall[]>(`/dispatch/history-map?${params}`);
      const calls = Array.isArray(data) ? data : [];
      setCalls(calls);
      setTotal(calls.length);

      whenStyleReady(map, () => {
        renderOnMap(calls, map);
      });
    } catch (err) {
      console.warn('[useMapboxHistoryCalls] fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load call history');
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  const clear = useCallback(() => {
    clearFromMap();
    setCalls([]);
    setTotal(0);
    setError(null);
  }, [clearFromMap]);

  return { calls, total, loading, error, fetchHistory, clear };
}
