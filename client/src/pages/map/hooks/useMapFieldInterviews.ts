import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';
import { getOverlayMarkerClass } from '../utils/mapMarkerBuilders';
import { whenStyleReady } from '../utils/safeAddSource';

interface FIRecord {
  id: number;
  fi_number: string;
  subject_first_name: string | null;
  subject_last_name: string | null;
  latitude: number;
  longitude: number;
  contact_reason: string;
  action_taken: string | null;
  officer_name: string | null;
  created_at: string;
  location: string | null;
}

interface UseMapFieldInterviewsReturn {
  count: number;
  loading: boolean;
}

const REASON_COLORS: Record<string, string> = {
  trespass: '#f59e0b',
  suspicious: '#dc2626',
  welfare: '#888888',
};

function getReasonColor(reason: string): string {
  return REASON_COLORS[reason?.toLowerCase()] || '#666666';
}

function buildFIInfoContent(fi: FIRecord): string {
  const color = getReasonColor(fi.contact_reason);
  const name = [fi.subject_first_name, fi.subject_last_name].filter(Boolean).join(' ');

  return `
    <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
      <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">Field Interview ${fi.fi_number}</div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        <tr><td style="color:#888888;padding:1px 6px 1px 0">Subject</td><td style="color:#e0e0e0">${name || 'Unknown'}</td></tr>
        <tr><td style="color:#888888;padding:1px 6px 1px 0">Reason</td><td style="color:#e0e0e0">${fi.contact_reason}</td></tr>
        ${fi.action_taken ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Action</td><td style="color:#e0e0e0">${fi.action_taken}</td></tr>` : ''}
        ${fi.officer_name ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Officer</td><td style="color:#e0e0e0">${fi.officer_name}</td></tr>` : ''}
        ${fi.location ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Location</td><td style="color:#e0e0e0">${fi.location}</td></tr>` : ''}
        <tr><td style="color:#888888;padding:1px 6px 1px 0">Date</td><td style="color:#e0e0e0">${fi.created_at ? parseTimestamp(fi.created_at).toLocaleString() : ''}</td></tr>
      </table>
    </div>
  `;
}

export function useMapFieldInterviews(
  map: mapboxgl.Map | null,
  enabled: boolean,
  days: number = 30,
): UseMapFieldInterviewsReturn {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const sourceId = 'field-interviews';

  const clearMarkers = useCallback(() => {
    if (map) {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  }, [map]);

  const renderMarkers = useCallback((records: FIRecord[]) => {
    if (!map) return;

    clearMarkers();

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const withCoords = records.filter(
      (fi) => fi.latitude != null && fi.longitude != null && !isNaN(Number(fi.latitude)) && !isNaN(Number(fi.longitude))
    );

    setCount(withCoords.length);

    if (withCoords.length === 0) return;

    const features = withCoords.map((fi) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [fi.longitude, fi.latitude] as [number, number] },
      properties: { id: fi.id, fi_number: fi.fi_number, contact_reason: fi.contact_reason, created_at: fi.created_at },
    }));

    whenStyleReady(map, () => {
      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: sourceId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-color': [
            'case',
            ['==', ['get', 'contact_reason'], 'trespass'], '#f59e0b',
            ['==', ['get', 'contact_reason'], 'suspicious'], '#dc2626',
            ['==', ['get', 'contact_reason'], 'welfare'], '#888888',
            '#666666',
          ],
          'circle-radius': 8,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
          'circle-opacity': [
            'interpolate', ['linear'],
            ['-', ['number', ['/', ['-', ['now'], ['to-number', ['to-date', ['get', 'created_at']]]], 86400000], 60], 0],
            0, 1,
            60, 0.4,
          ],
        },
      });

      map.on('click', sourceId, (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const fi = withCoords.find(f => f.id === feature.properties?.id);
        if (!fi) return;
        if (popupRef.current) {
          popupRef.current.setLngLat(e.lngLat).setHTML(buildFIInfoContent(fi)).addTo(map);
        }
      });
    });
  }, [map, clearMarkers]);

  useEffect(() => {
    if (!map) return;

    if (!enabled) {
      clearMarkers();
      setCount(0);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiFetch<FIRecord[]>(`/field-interviews/map?days=${days}`)
      .then((data) => {
        if (cancelled) return;
        const records = Array.isArray(data) ? data : [];
        renderMarkers(records);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[useMapFieldInterviews] Field interviews fetch failed:', err);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [map, enabled, days, clearMarkers, renderMarkers]);

  useEffect(() => {
    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, []);

  return { count, loading };
}
