import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';
import { buildIncidentReportMarkerContent, getOverlayMarkerClass } from '../utils/mapMarkerBuilders';
import type { OverlayMarker } from '../utils/mapMarkerBuilders';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { escapeHtml } from '../../../utils/sanitize';
import { whenStyleReady } from '../utils/safeAddSource';

export interface MapIncidentReport {
  id: number;
  incident_number: string;
  incident_type: string;
  priority: string;
  status: string;
  location_address: string;
  latitude: number;
  longitude: number;
  narrative_preview: string | null;
  officer_name: string | null;
  created_at: string;
  call_number: string | null;
  case_number: string | null;
}

interface UseMapIncidentReportsOptions {
  map: mapboxgl.Map | null;
  enabled: boolean;
  days: number;
  statuses: string[];
  types: string[];
}

interface UseMapIncidentReportsReturn {
  incidents: MapIncidentReport[];
  loading: boolean;
  count: number;
  countsByStatus: Record<string, number>;
}

const STATUS_COLORS: Record<string, string> = {
  draft: '#666666',
  submitted: '#888888',
  under_review: '#f59e0b',
  approved: '#22c55e',
  returned: '#ef4444',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  returned: 'Returned',
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#dc2626',
  P2: '#f59e0b',
  P3: '#888888',
  P4: '#666666',
};

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  try {
    const d = parseTimestamp(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return iso; }
}

export function useMapIncidentReports(opts: UseMapIncidentReportsOptions): UseMapIncidentReportsReturn {
  const { map, enabled, days, statuses, types } = opts;

  const [incidents, setIncidents] = useState<MapIncidentReport[]>([]);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const sourceId = 'incident-reports';

  const clearMarkers = useCallback(() => {
    if (map) {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  }, [map]);

  const renderMarkers = useCallback((data: MapIncidentReport[]) => {
    if (!map) return;

    clearMarkers();

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const validIncidents = data.filter((inc) => inc.latitude != null && inc.longitude != null);
    if (validIncidents.length === 0) return;

    const features = validIncidents.map((incident) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [incident.longitude, incident.latitude] as [number, number] },
      properties: {
        id: incident.id,
        incident_number: incident.incident_number,
        incident_type: incident.incident_type,
        priority: incident.priority,
        status: incident.status,
        location_address: incident.location_address,
        narrative_preview: incident.narrative_preview,
        officer_name: incident.officer_name,
        created_at: incident.created_at,
        call_number: incident.call_number,
        case_number: incident.case_number,
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
            ['==', ['get', 'status'], 'draft'], '#666666',
            ['==', ['get', 'status'], 'submitted'], '#888888',
            ['==', ['get', 'status'], 'under_review'], '#f59e0b',
            ['==', ['get', 'status'], 'approved'], '#22c55e',
            ['==', ['get', 'status'], 'returned'], '#ef4444',
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
      const sColor = STATUS_COLORS[p.status as string] || '#666666';
      const pColor = PRIORITY_COLORS[p.priority as string] || '#666666';
      const sLabel = STATUS_LABELS[p.status as string] || p.status;

      const html = `
        <div style="min-width:220px;max-width:320px;font-family:'Courier New',monospace;background:#0c0c0c;color:#e5e7eb;padding:10px;border:1px solid ${sColor}40;border-radius:4px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-weight:900;font-size:13px;color:#e5e7eb;">${escapeHtml(p.incident_number as string)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="font-size:10px;color:#d1d5db;font-weight:bold;">${escapeHtml(formatIncidentType(p.incident_type as string))}</span>
            ${p.priority ? `<span style="background:${pColor};color:white;padding:1px 6px;font-size:8px;font-weight:900;letter-spacing:0.5px;border-radius:1px;">${escapeHtml(p.priority as string)}</span>` : ''}
          </div>
          <div style="margin-bottom:6px;">
            <span style="font-size:9px;text-transform:uppercase;color:${sColor};font-weight:800;letter-spacing:1px;padding:1px 6px;background:${sColor}20;border:1px solid ${sColor}30;border-radius:2px;">${escapeHtml(sLabel)}</span>
          </div>
          <div style="font-size:10px;color:#d1d5db;">${escapeHtml(p.location_address as string || '')}</div>
          ${p.narrative_preview ? `<div style="font-size:9px;color:#6b7280;margin-top:6px;padding-top:4px;border-top:1px solid #2b2b2b;max-height:40px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.narrative_preview as string)}</div>` : ''}
          <div style="margin-top:8px;padding-top:6px;border-top:1px solid #2b2b2b;font-size:9px;">
            ${p.officer_name ? `<div style="color:#9ca3af;margin-bottom:2px;">${escapeHtml(p.officer_name as string)}</div>` : ''}
            <div style="color:#545454;">${escapeHtml(formatDate(p.created_at as string))}</div>
            ${p.call_number ? `<div style="color:#a0a0a0;margin-top:3px;font-weight:bold;">CFS: ${escapeHtml(p.call_number as string)}</div>` : ''}
            ${p.case_number ? `<div style="color:#d4a017;margin-top:2px;font-weight:bold;">Case: ${escapeHtml(p.case_number as string)}</div>` : ''}
          </div>
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
      setIncidents([]);
      return;
    }

    const params = new URLSearchParams();
    params.set('days', String(days));
    if (statuses.length > 0) params.set('status', statuses.join(','));
    if (types.length > 0) params.set('types', types.join(','));

    let cancelled = false;
    setLoading(true);
    apiFetch<MapIncidentReport[]>(`/incidents/map?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        const arr = Array.isArray(data) ? data : [];
        setIncidents(arr);
        renderMarkers(arr);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[useMapIncidentReports] Incident fetch failed:', err);
        setIncidents([]);
        clearMarkers();
        setLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled, days, statuses.join(','), types.join(','), clearMarkers, renderMarkers]);

  useEffect(() => {
    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, []);

  const countsByStatus = incidents.reduce<Record<string, number>>((acc, inc) => {
    acc[inc.status] = (acc[inc.status] || 0) + 1;
    return acc;
  }, {});

  return { incidents, loading, count: incidents.length, countsByStatus };
}
