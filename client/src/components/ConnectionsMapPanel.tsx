// ============================================================
// RMPG Flex — Connections Map Overlay Panel (Mapbox)
// ============================================================
// Read-only geo detail view for the currently-selected graph node.
// GPS breadcrumbs and ALPR sightings are NOT graph nodes (too
// high-volume) — this panel is the only place they're geo-rendered,
// reusing the mapboxLoader/mapboxBasemap init pattern from
// ForensicTrackMap.tsx rather than a new map integration.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { initMapbox, mapboxgl, MAPBOX_STYLE_DARK, registerMapInstance, unregisterMapInstance } from '../utils/mapboxLoader';
import { getMapboxAccessToken } from '../utils/mapboxApiKey';
import { applyRmpgBasemap } from '../utils/mapboxBasemap';
import { buildDotMarker, isValidLngLat } from '../utils/mapMarkers';
import { apiFetch } from '../hooks/useApi';

const CYAN = '#06b6d4';

interface Props {
  nodeType: string;
  nodeEntityId: number;
  dateFrom?: string;
  dateTo?: string;
  height?: number;
}

export default function ConnectionsMapPanel({ nodeType, nodeEntityId, dateFrom, dateTo, height = 220 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [loading, setLoading] = useState(true);
  const [pointCount, setPointCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        // Promise.resolve(...) guards against a test-mock (or any future
        // apiFetch implementation) that returns a non-Promise value —
        // calling .catch directly on apiFetch(...) throws synchronously
        // if the return value isn't thenable, which previously produced
        // an unhandled rejection instead of the graceful empty state.
        const [trackRes, geoRes] = await Promise.all([
          Promise.resolve(apiFetch<{ data: Array<{ lat: number; lng: number }> }>(`/connections/${nodeType}/${nodeEntityId}/gps-track?${params}`)).catch(() => ({ data: [] })),
          Promise.resolve(apiFetch<{ data: Array<{ lat: number; lng: number; label?: string }> }>(`/connections/${nodeType}/${nodeEntityId}/geo-points?${params}`)).catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const track = ((trackRes && trackRes.data) || []).filter((p) => isValidLngLat(p.lng, p.lat));
        const points = ((geoRes && geoRes.data) || []).filter((p) => isValidLngLat(p.lng, p.lat));
        setPointCount(track.length + points.length);

        // getMapboxAccessToken() THROWS (not rejects-to-empty-string) when
        // no token is configured — e.g. every jsdom test environment. That
        // must degrade to the "No geo data" empty state, not an unhandled
        // rejection, so it's inside this same try/catch.
        const token = await getMapboxAccessToken();
        if (cancelled || !containerRef.current) return;
        initMapbox(token);
        const first = track[0] || points[0];
        const center: [number, number] = first ? [first.lng, first.lat] : [-111.891, 40.7608];
        const map = new mapboxgl.Map({ container: containerRef.current, style: MAPBOX_STYLE_DARK, center, zoom: 12, attributionControl: false });
        mapRef.current = map;
        registerMapInstance(map);
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
        map.on('load', () => {
          if (cancelled) return;
          if (track.length > 1) {
            const line = track.map((p) => [p.lng, p.lat]);
            map.addSource('gps-track', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } } });
            map.addLayer({ id: 'gps-track', type: 'line', source: 'gps-track', paint: { 'line-color': CYAN, 'line-width': 3, 'line-opacity': 0.85 } });
          }
          for (const p of points) {
            const el = buildDotMarker({ color: '#ef4444', size: 10 });
            const m = new mapboxgl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
            markersRef.current.push(m);
          }
          const all = [...track, ...points];
          if (all.length > 1) {
            const b = all.reduce((acc, pt) => acc.extend([pt.lng, pt.lat]), new mapboxgl.LngLatBounds([all[0].lng, all[0].lat], [all[0].lng, all[0].lat]));
            map.fitBounds(b, { padding: 32, maxZoom: 15, duration: 0 });
          }
        });
      } catch (err) {
        // Token missing/misconfigured, apiFetch throwing, or any other
        // init failure — degrade to the existing empty state rather than
        // an unhandled rejection.
        console.error('[ConnectionsMapPanel] init error:', (err as Error)?.message);
        if (!cancelled) setPointCount(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => { try { m.remove(); } catch { /* idempotent */ } });
      markersRef.current = [];
      if (mapRef.current) { unregisterMapInstance(mapRef.current); mapRef.current.remove(); mapRef.current = null; }
    };
  }, [nodeType, nodeEntityId, dateFrom, dateTo]);

  return (
    <div className="relative panel-beveled bg-surface-sunken" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-sunken/80">
          <Loader2 size={20} className="animate-spin text-brand-400" />
        </div>
      )}
      {!loading && pointCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-rmpg-500">
          No geo data for this entity.
        </div>
      )}
    </div>
  );
}
