import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { PRIORITY_COLORS } from '../utils/mapConstants';
import { buildHistoricalCallMarkerContent, getOverlayMarkerClass } from '../utils/mapMarkerBuilders';
import type { OverlayMarker } from '../utils/mapMarkerBuilders';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { escapeHtml } from '../../../utils/sanitize';
import { whenStyleReady } from '../utils/safeAddSource';

export interface HistoricalCall {
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
  cleared_at: string | null;
  response_time_min: number | null;
  assigned_units: string;
  description: string | null;
  source: string | null;
}

interface UseMapCallHistoryOptions {
  map: mapboxgl.Map | null;
  enabled: boolean;
  days: number;
  statuses: string[];
  types: string[];
  priorities: string[];
}

interface UseMapCallHistoryReturn {
  calls: HistoricalCall[];
  loading: boolean;
  count: number;
  incidentCategories: string[];
}

function formatResponseTime(minutes: number | null): string {
  if (minutes == null) return '-';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}min`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00');
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: true,
    });
  } catch { return iso; }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'cleared': return '#22c55e';
    case 'closed': return '#666666';
    case 'archived': return '#555555';
    default: return '#666666';
  }
}

function getSourceLabel(source: string | null): string {
  if (!source) return '';
  const labels: Record<string, string> = {
    phone: 'Phone', radio: 'Radio', walk_in: 'Walk-in',
    online: 'Online', self_initiated: 'Self-Init', alarm: 'Alarm',
    '911': '911', transfer: 'Transfer',
  };
  return labels[source] || source;
}

export function useMapCallHistory(opts: UseMapCallHistoryOptions): UseMapCallHistoryReturn {
  const { map, enabled, days, statuses, types, priorities } = opts;

  const [calls, setCalls] = useState<HistoricalCall[]>([]);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const sourceId = 'call-history';

  const clearMarkers = useCallback(() => {
    if (map) {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  }, [map]);

  const renderMarkers = useCallback((data: HistoricalCall[]) => {
    if (!map) return;

    clearMarkers();

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const validCalls = data.filter((call) => call.latitude != null && call.longitude != null);
    if (validCalls.length === 0) return;

    const features = validCalls.map((call) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [call.longitude, call.latitude] as [number, number] },
      properties: {
        id: call.id,
        call_number: call.call_number,
        incident_type: call.incident_type,
        priority: call.priority,
        status: call.status,
        disposition: call.disposition,
        location_address: call.location_address,
        created_at: call.created_at,
        cleared_at: call.cleared_at,
        response_time_min: call.response_time_min,
        assigned_units: call.assigned_units,
        description: call.description,
        source: call.source,
      },
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
            ['==', ['get', 'priority'], 'P1'], '#dc2626',
            ['==', ['get', 'priority'], 'P2'], '#f59e0b',
            ['==', ['get', 'priority'], 'P3'], '#888888',
            '#666666',
          ],
          'circle-radius': 8,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1,
        },
      });

      map.on('click', sourceId, (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;
      const p = feature.properties;
      const pColor = PRIORITY_COLORS[p.priority as string] || '#666666';
      const sColor = getStatusColor(p.status as string);

      const html = `
        <div style="min-width:220px;max-width:320px;font-family:'Courier New',monospace;background:#0c0c0c;color:#e5e7eb;padding:10px;border:1px solid ${pColor}40;border-radius:4px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="background:${pColor};color:white;padding:2px 8px;font-size:10px;font-weight:900;letter-spacing:0.5px;">${escapeHtml(p.priority as string)}</span>
            <span style="font-weight:900;font-size:13px;color:${pColor};">${escapeHtml(formatIncidentType(p.incident_type as string))}</span>
          </div>
          <div style="font-size:12px;color:#a0a0a0;font-weight:bold;">${escapeHtml(p.call_number as string)}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
            <span style="font-size:9px;text-transform:uppercase;color:${sColor};font-weight:800;letter-spacing:1px;padding:1px 6px;background:${sColor}20;border:1px solid ${sColor}30;border-radius:2px;">${escapeHtml(p.status as string)}</span>
            ${p.disposition ? `<span style="font-size:9px;color:#9ca3af;">${escapeHtml(p.disposition as string)}</span>` : ''}
          </div>
          <div style="font-size:10px;margin-top:6px;color:#d1d5db;">${escapeHtml(p.location_address as string || '')}</div>
          <div style="margin-top:8px;padding-top:6px;border-top:1px solid #2b2b2b;">
            <div style="display:flex;gap:12px;font-size:9px;color:#5a6e80;">
              <div><span style="color:#9ca3af;font-weight:bold;">Response:</span> ${escapeHtml(formatResponseTime(p.response_time_min as number | null))}</div>
            </div>
            ${p.assigned_units ? `<div style="font-size:9px;color:#a0a0a0;margin-top:4px;font-weight:bold;">${escapeHtml(p.assigned_units as string)}</div>` : ''}
            <div style="font-size:8px;color:#545454;margin-top:4px;">
              ${escapeHtml(formatTimestamp(p.created_at as string))} &rarr; ${escapeHtml(formatTimestamp(p.cleared_at as string | null))}
            </div>
          </div>
          ${p.description ? `<div style="font-size:9px;color:#6b7280;margin-top:6px;padding-top:4px;border-top:1px solid #2b2b2b;max-height:40px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml((p.description as string).substring(0, 150))}</div>` : ''}
          ${p.source ? `<div style="margin-top:4px;"><span style="font-size:8px;color:#5a6e80;padding:1px 4px;background:#2b2b2b30;border:1px solid #2b2b2b60;border-radius:2px;">${escapeHtml(getSourceLabel(p.source as string | null))}</span></div>` : ''}
        </div>
      `;
      if (popupRef.current) {
        popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
      }
      });
    });
  }, [map, clearMarkers]);

  useEffect(() => {
    if (!map || !enabled) {
      clearMarkers();
      setCalls([]);
      return;
    }

    const params = new URLSearchParams();
    params.set('days', String(days));
    if (statuses.length > 0) params.set('status', statuses.join(','));
    if (types.length > 0) params.set('types', types.join(','));
    if (priorities.length > 0) params.set('priority', priorities.join(','));

    let cancelled = false;
    setLoading(true);
    apiFetch<HistoricalCall[]>(`/dispatch/history-map?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        const arr = Array.isArray(data) ? data : [];
        setCalls(arr);
        renderMarkers(arr);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[useMapCallHistory] History fetch failed:', err);
        setCalls([]);
        clearMarkers();
        setLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled, days, statuses.join(','), types.join(','), priorities.join(','), clearMarkers, renderMarkers]);

  useEffect(() => {
    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, []);

  const incidentCategories = Array.from(new Set(calls.map(c => c.incident_type).filter(Boolean)));

  return { calls, loading, count: calls.length, incidentCategories };
}
