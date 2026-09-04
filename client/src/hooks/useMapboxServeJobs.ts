// Process Server Job Overlay — active serve_queue items with a geocoded
// recipient address, shown on the main Dispatch/Map module.
// Fetches /api/process-server/active-routes and renders as priority-colored
// circles using the shared serveMapUtils layer helpers.
import { useCallback, useState, useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import {
  addServeJobLayer, removeServeJobLayer, serveJobPopupHTML,
  type ServeMapEntry,
} from '../utils/serveMapUtils';

// Re-export so consumers that imported ServeMapJob from this module keep working.
export type { ServeMapEntry as ServeMapJob };

const SOURCE_ID = 'rmpg-serve-jobs-source';
const CIRCLE_LAYER_ID = `${SOURCE_ID}-circle`;

export function useMapboxServeJobs(map: mapboxgl.Map | null) {
  const [jobs, setJobs] = useState<ServeMapEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  // Track click handler so it can be removed before a new one is added,
  // preventing duplicate listeners from accumulating on re-renders.
  const clickHandlerRef = useRef<((e: mapboxgl.MapLayerMouseEvent) => void) | null>(null);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    popupRef.current?.remove();
    popupRef.current = null;
    if (clickHandlerRef.current) {
      try { map.off('click', CIRCLE_LAYER_ID, clickHandlerRef.current); } catch { /* ignore */ }
      clickHandlerRef.current = null;
    }
    removeServeJobLayer(map, SOURCE_ID);
  }, [map]);

  const renderOnMap = useCallback((rows: ServeMapEntry[], m: mapboxgl.Map) => {
    clearFromMap();
    addServeJobLayer(m, rows, SOURCE_ID);

    const clickHandler = (e: mapboxgl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f || f.geometry.type !== 'Point') return;
      const jobId = f.properties?.id as number;
      const job = rows.find(j => j.id === jobId);
      if (!job) return;
      popupRef.current?.remove();
      popupRef.current = new mapboxgl.Popup({ offset: 10, closeButton: true, className: 'mapbox-popup-dark' })
        .setLngLat(f.geometry.coordinates as [number, number])
        .setHTML(serveJobPopupHTML(job, { showAddToRoute: true }))
        .addTo(m);
    };
    clickHandlerRef.current = clickHandler;
    m.on('click', CIRCLE_LAYER_ID, clickHandler);
    m.on('mouseenter', CIRCLE_LAYER_ID, () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', CIRCLE_LAYER_ID, () => { m.getCanvas().style.cursor = ''; });
  }, [clearFromMap]);

  const fetchJobs = useCallback(async () => {
    if (!map) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ jobs: ServeMapEntry[] }>('/process-server/active-routes');
      const rows = data?.jobs ?? [];
      setJobs(rows);
      whenStyleReady(map, () => { renderOnMap(rows, map); });
    } catch (err) {
      console.warn('[useMapboxServeJobs] fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load serve jobs');
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  // Poll every 60 seconds to keep the overlay current without a full page reload.
  useEffect(() => {
    if (!map) return;
    fetchJobs();
    const id = setInterval(fetchJobs, 60_000);
    return () => {
      clearInterval(id);
      clearFromMap();
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  return { jobs, loading, error, fetchJobs, clear: clearFromMap };
}
