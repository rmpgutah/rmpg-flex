// ============================================================
// RMPG Flex — useMapIncidentReports Hook
// Incident report data layer: diamond-shaped markers with
// status-coded colors and rich InfoWindow details.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { buildIncidentReportMarkerContent, getOverlayMarkerClass } from '../utils/mapMarkerBuilders';
import type { OverlayMarker } from '../utils/mapMarkerBuilders';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { escapeHtml } from '../../../utils/sanitize';

// ─── Types ──────────────────────────────────────────────────

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
  map: google.maps.Map | null;
  enabled: boolean;
  days: number;
  statuses: string[];
  types: string[];
}

interface UseMapIncidentReportsReturn {
  incidents: MapIncidentReport[];
  loading: boolean;
  count: number;
  // Fix 86: counts by status for display
  countsByStatus: Record<string, number>;
}

// ─── Helpers ────────────────────────────────────────────────

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
    const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00');
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return iso; }
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapIncidentReports(opts: UseMapIncidentReportsOptions): UseMapIncidentReportsReturn {
  const { map, enabled, days, statuses, types } = opts;

  const [incidents, setIncidents] = useState<MapIncidentReport[]>([]);
  const [loading, setLoading] = useState(false);

  const markersRef = useRef<(OverlayMarker & google.maps.OverlayView)[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // ── Clear markers ───────────────────────────────────────

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
  }, []);

  // ── Render markers ──────────────────────────────────────

  const renderMarkers = useCallback((data: MapIncidentReport[]) => {
    const OverlayMarkerClass = getOverlayMarkerClass();
    if (!map || !OverlayMarkerClass) return;

    clearMarkers();

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    data.forEach((incident) => {
      if (incident.latitude == null || incident.longitude == null) return;

      const content = buildIncidentReportMarkerContent(incident.status);

      const marker = new OverlayMarkerClass({
        map,
        position: { lat: incident.latitude, lng: incident.longitude },
        content,
        title: `${incident.incident_number} - ${formatIncidentType(incident.incident_type)}`,
        zIndex: 40,
        onClick: () => {
        const sColor = STATUS_COLORS[incident.status] || '#666666';
        const pColor = PRIORITY_COLORS[incident.priority] || '#666666';
        const sLabel = STATUS_LABELS[incident.status] || incident.status;

        infoWindowRef.current?.setContent(`
          <div style="min-width:220px;max-width:320px;font-family:'Courier New',monospace;background:#0d1520;color:#e5e7eb;padding:10px;border:1px solid ${sColor}40;border-radius:4px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <span style="font-weight:900;font-size:13px;color:#e5e7eb;">${escapeHtml(incident.incident_number)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
              <span style="font-size:10px;color:#d1d5db;font-weight:bold;">${escapeHtml(formatIncidentType(incident.incident_type))}</span>
              ${incident.priority ? `<span style="background:${pColor};color:white;padding:1px 6px;font-size:8px;font-weight:900;letter-spacing:0.5px;border-radius:1px;">${escapeHtml(incident.priority)}</span>` : ''}
            </div>
            <div style="margin-bottom:6px;">
              <span style="font-size:9px;text-transform:uppercase;color:${sColor};font-weight:800;letter-spacing:1px;padding:1px 6px;background:${sColor}20;border:1px solid ${sColor}30;border-radius:2px;">${escapeHtml(sLabel)}</span>
            </div>
            <div style="font-size:10px;color:#d1d5db;">${escapeHtml(incident.location_address || '')}</div>
            ${incident.narrative_preview ? `<div style="font-size:9px;color:#6b7280;margin-top:6px;padding-top:4px;border-top:1px solid #1e3048;max-height:40px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(incident.narrative_preview)}</div>` : ''}
            <div style="margin-top:8px;padding-top:6px;border-top:1px solid #1e3048;font-size:9px;">
              ${incident.officer_name ? `<div style="color:#9ca3af;margin-bottom:2px;">${escapeHtml(incident.officer_name)}</div>` : ''}
              <div style="color:#4b5563;">${escapeHtml(formatDate(incident.created_at))}</div>
              ${incident.call_number ? `<div style="color:#999999;margin-top:3px;font-weight:bold;">CFS: ${escapeHtml(incident.call_number)}</div>` : ''}
              ${incident.case_number ? `<div style="color:#d4a017;margin-top:2px;font-weight:bold;">Case: ${escapeHtml(incident.case_number)}</div>` : ''}
            </div>
          </div>
        `);
        infoWindowRef.current?.setPosition({ lat: incident.latitude, lng: incident.longitude });
        infoWindowRef.current?.open(map);
      },
      });

      markersRef.current.push(marker as OverlayMarker & google.maps.OverlayView);
    });
  }, [map, clearMarkers]);

  // ── Fetch & render on filter change ─────────────────────

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
  // Memoize join strings to stabilize dependency references
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled, days, statuses.join(','), types.join(','), clearMarkers, renderMarkers]);

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
        infoWindowRef.current = null;
      }
    };
  }, []);

  // Fix 86: counts by status for display
  const countsByStatus = incidents.reduce<Record<string, number>>((acc, inc) => {
    acc[inc.status] = (acc[inc.status] || 0) + 1;
    return acc;
  }, {});

  return { incidents, loading, count: incidents.length, countsByStatus };
}
