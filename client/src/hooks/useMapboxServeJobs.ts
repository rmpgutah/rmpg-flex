// Process Server Job Overlay — active serve_queue items with a geocoded
// recipient address, shown on the main Dispatch/Map module.
// Fetches /api/serve/active-routes (src/routes/serve.ts) and renders as
// priority-colored circles, mirroring useMapboxRepeatAddresses.ts's
// self-contained fetch/render/clear shape so it slots into the same
// layerRegistry/useLayerBindings toggle system as every other overlay.
//
// Before this hook, Process Server jobs were only visible on the dedicated
// ServeIntakeMap.tsx component — never on the main Map/Dispatch view — so a
// dispatcher watching the live map had no way to see pending serves at all.
import { useCallback, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { buildDetailPopupHtml } from '../pages/map/utils/mapMarkers';
import { escapeHtml } from '../utils/sanitize';
import { formatDateTime } from '../utils/dateUtils';

// Matches the serve_queue row shape returned by GET /serve/active-routes.
export interface ServeMapJob {
  id: number;
  status: string;
  priority: string;
  recipient_name: string | null;
  recipient_address: string | null;
  recipient_lat: number | null;
  recipient_lng: number | null;
  case_number: string | null;
  client_name: string | null;
  document_type: string | null;
  deadline: string | null;
}

// Same ordinal priority palette ServeIntakeMap.tsx uses for the dedicated
// Process Server map, so a job reads the same color on either surface.
const SERVE_PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ef4444',
  rush: '#f97316',
  normal: '#3b82f6',
  routine: '#6b7280',
};

const SOURCE_ID = 'rmpg-serve-jobs-source';
const CIRCLE_LAYER_ID = 'rmpg-serve-jobs-circle';
const LABEL_LAYER_ID = 'rmpg-serve-jobs-label';

export function useMapboxServeJobs(map: mapboxgl.Map | null) {
  const [jobs, setJobs] = useState<ServeMapJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    popupRef.current?.remove();
    popupRef.current = null;
    try {
      if (hasLayer(map, LABEL_LAYER_ID)) safeRemoveLayer(map, LABEL_LAYER_ID);
      if (hasLayer(map, CIRCLE_LAYER_ID)) safeRemoveLayer(map, CIRCLE_LAYER_ID);
      if (hasSource(map, SOURCE_ID)) safeRemoveSource(map, SOURCE_ID);
    } catch { /* ignore */ }
  }, [map]);

  const renderOnMap = useCallback((rows: ServeMapJob[], m: mapboxgl.Map) => {
    clearFromMap();

    const features: GeoJSON.Feature[] = rows
      .filter((j) => j.recipient_lat != null && j.recipient_lng != null)
      .map((j) => ({
        type: 'Feature',
        properties: {
          id: j.id,
          recipient_name: j.recipient_name,
          recipient_address: j.recipient_address,
          case_number: j.case_number,
          client_name: j.client_name,
          document_type: j.document_type,
          deadline: j.deadline,
          status: j.status,
          color: SERVE_PRIORITY_COLOR[j.priority] ?? SERVE_PRIORITY_COLOR.routine,
        },
        geometry: { type: 'Point', coordinates: [j.recipient_lng as number, j.recipient_lat as number] },
      }));

    m.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    m.addLayer({
      id: CIRCLE_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': 7,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.85,
        'circle-stroke-color': '#0d1520',
        'circle-stroke-width': 2,
      },
    });

    m.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      minzoom: 12,
      layout: {
        'text-field': ['coalesce', ['get', 'case_number'], ''],
        'text-size': 9,
        'text-offset': [0, 1.3],
        'text-anchor': 'top',
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
      },
      paint: {
        'text-color': '#f0f4f9',
        'text-halo-color': '#0a0a0a',
        'text-halo-width': 1.5,
      },
    });

    m.on('click', CIRCLE_LAYER_ID, (e) => {
      const f = e.features?.[0];
      if (!f || f.geometry.type !== 'Point') return;
      const p = f.properties || {};
      popupRef.current?.remove();
      popupRef.current = new mapboxgl.Popup({ offset: 10, closeButton: true, className: 'mapbox-popup-dark' })
        .setLngLat(f.geometry.coordinates as [number, number])
        .setHTML(buildDetailPopupHtml(escapeHtml(p.recipient_name || 'Serve Job'), [
          ['Case #', p.case_number],
          ['Client', p.client_name],
          ['Document', p.document_type],
          ['Address', p.recipient_address],
          ['Status', p.status],
          ['Deadline', p.deadline ? formatDateTime(p.deadline) : null],
        ]))
        .addTo(m);
    });
    m.on('mouseenter', CIRCLE_LAYER_ID, () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', CIRCLE_LAYER_ID, () => { m.getCanvas().style.cursor = ''; });
  }, [clearFromMap]);

  const fetchJobs = useCallback(async () => {
    if (!map) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ jobs: ServeMapJob[] }>('/serve/active-routes');
      const rows = data?.jobs || [];
      setJobs(rows);
      whenStyleReady(map, () => { renderOnMap(rows, map); });
    } catch (err: any) {
      console.warn('[useMapboxServeJobs] fetch failed:', err);
      setError(err?.message || 'Failed to load serve jobs');
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  return { jobs, loading, error, fetchJobs, clear: clearFromMap };
}
