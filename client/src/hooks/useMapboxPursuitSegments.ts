// Pursuit Segments Overlay — draws the GPS track for recent vehicle/foot
// pursuits. /dispatch/gps/pursuit-segments only returns per-pursuit stats
// (no path), so each segment's line is filled in from the existing
// /dispatch/gps/history endpoint over its [start_time, end_time] window.
import { useCallback, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { hasLayer, safeRemoveLayer, safeRemoveSource, upsertGeoJsonSource } from '../utils/mapboxSafeLayer';
import { buildDetailPopupHtml } from '../pages/map/utils/mapMarkers';
import { formatDateTime } from '../utils/dateUtils';

export interface PursuitSegment {
  call_id: number;
  unit_id: number;
  call_sign: string;
  officer_name: string;
  start_time: string;
  end_time: string | null;
  max_speed: number;
  avg_speed: number;
  point_count: number;
}

interface HistoryPoint { lat: number; lng: number }

const SOURCE_ID = 'rmpg-pursuit-segments-source';
const LAYER_ID = 'rmpg-pursuit-segments-layer';

export function useMapboxPursuitSegments(map: mapboxgl.Map | null) {
  const [segments, setSegments] = useState<PursuitSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const clear = useCallback(() => {
    if (!map) return;
    popupRef.current?.remove();
    popupRef.current = null;
    safeRemoveLayer(map, LAYER_ID);
    safeRemoveSource(map, SOURCE_ID);
  }, [map]);

  const renderOnMap = useCallback(async (segs: PursuitSegment[], m: mapboxgl.Map) => {
    const features: GeoJSON.Feature[] = [];
    for (const seg of segs) {
      if (!seg.end_time) continue; // still in progress — no closed window to replay
      try {
        const trail = await apiFetch<{ points: HistoryPoint[] }>(
          `/dispatch/gps/history?unit_id=${seg.unit_id}&from=${encodeURIComponent(seg.start_time)}&to=${encodeURIComponent(seg.end_time)}`
        );
        const coords = (trail.points || [])
          .filter((p) => p.lat != null && p.lng != null)
          .map((p) => [p.lng, p.lat]);
        if (coords.length >= 2) {
          features.push({
            type: 'Feature',
            properties: {
              call_id: seg.call_id, call_sign: seg.call_sign, officer_name: seg.officer_name,
              max_speed: seg.max_speed, avg_speed: seg.avg_speed, start_time: seg.start_time,
            },
            geometry: { type: 'LineString', coordinates: coords },
          });
        }
      } catch (err) {
        // one segment's history failing shouldn't drop the rest
        console.warn(`[useMapboxPursuitSegments] segment ${seg.call_id} history fetch failed:`, err);
      }
    }

    const geojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
    upsertGeoJsonSource(m, SOURCE_ID, geojson);
    if (hasLayer(m, LAYER_ID)) return;

    m.addLayer({
      id: LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#dc2626', 'line-width': 3, 'line-opacity': 0.85 },
    });

    m.on('click', LAYER_ID, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties || {};
      popupRef.current?.remove();
      popupRef.current = new mapboxgl.Popup({ offset: 4, closeButton: true, className: 'mapbox-popup-dark' })
        .setLngLat(e.lngLat)
        .setHTML(buildDetailPopupHtml(`Pursuit — ${p.call_sign || 'Unit'}`, [
          ['Officer', p.officer_name],
          ['Max Speed', p.max_speed != null ? `${p.max_speed} mph` : null],
          ['Avg Speed', p.avg_speed != null ? `${p.avg_speed} mph` : null],
          ['Started', p.start_time ? formatDateTime(p.start_time) : null],
        ]))
        .addTo(m);
    });
    m.on('mouseenter', LAYER_ID, () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', LAYER_ID, () => { m.getCanvas().style.cursor = ''; });
  }, []);

  const fetchSegments = useCallback(async (hours = 4) => {
    if (!map) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<PursuitSegment[]>(`/dispatch/gps/pursuit-segments?hours=${hours}`);
      const list = Array.isArray(data) ? data : [];
      setSegments(list);
      await renderOnMap(list, map);
    } catch (err) {
      console.warn('[useMapboxPursuitSegments] fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load pursuit tracks');
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  return { segments, loading, error, fetchSegments, clear };
}
