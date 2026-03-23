// ============================================================
// RMPG Flex — useMapCallHistory Hook
// Historical call data layer: cleared/closed/archived calls
// with full InfoWindow details and filter support.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { PRIORITY_COLORS } from '../utils/mapConstants';
import { buildHistoricalCallMarkerContent } from '../utils/mapMarkerBuilders';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { escapeHtml } from '../../../utils/sanitize';

// ─── Types ──────────────────────────────────────────────────

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
  map: google.maps.Map | null;
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
}

// ─── Helpers ────────────────────────────────────────────────

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
    const d = new Date(iso);
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
    case 'closed': return '#6b7280';
    case 'archived': return '#4b5563';
    default: return '#6b7280';
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

// ─── Hook ───────────────────────────────────────────────────

export function useMapCallHistory(opts: UseMapCallHistoryOptions): UseMapCallHistoryReturn {
  const { map, enabled, days, statuses, types, priorities } = opts;

  const [calls, setCalls] = useState<HistoricalCall[]>([]);
  const [loading, setLoading] = useState(false);

  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // ── Clear markers ───────────────────────────────────────

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((m) => {
      if (window.google?.maps?.event) google.maps.event.clearInstanceListeners(m);
      m.map = null;
    });
    markersRef.current = [];
  }, []);

  // ── Render markers ──────────────────────────────────────

  const renderMarkers = useCallback((data: HistoricalCall[]) => {
    if (!map || !window.google?.maps?.marker?.AdvancedMarkerElement) return;

    clearMarkers();

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    data.forEach((call) => {
      if (call.latitude == null || call.longitude == null) return;

      const content = buildHistoricalCallMarkerContent(call.priority, call.incident_type, call.call_number);

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: call.latitude, lng: call.longitude },
        content,
        title: `${call.call_number} - ${formatIncidentType(call.incident_type)}`,
        zIndex: 50,
      });

      marker.addListener('click', () => {
        const pColor = PRIORITY_COLORS[call.priority] || '#5a6e80';
        const sColor = getStatusColor(call.status);

        infoWindowRef.current?.setContent(`
          <div style="min-width:220px;max-width:320px;font-family:'Courier New',monospace;background:#0d1520;color:#e5e7eb;padding:10px;border:1px solid ${pColor}40;border-radius:4px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <span style="background:${pColor};color:white;padding:2px 8px;font-size:10px;font-weight:900;letter-spacing:0.5px;">${escapeHtml(call.priority)}</span>
              <span style="font-weight:900;font-size:13px;color:${pColor};">${escapeHtml(formatIncidentType(call.incident_type))}</span>
            </div>
            <div style="font-size:12px;color:#60a5fa;font-weight:bold;">${escapeHtml(call.call_number)}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
              <span style="font-size:9px;text-transform:uppercase;color:${sColor};font-weight:800;letter-spacing:1px;padding:1px 6px;background:${sColor}20;border:1px solid ${sColor}30;border-radius:2px;">${escapeHtml(call.status)}</span>
              ${call.disposition ? `<span style="font-size:9px;color:#9ca3af;">${escapeHtml(call.disposition)}</span>` : ''}
            </div>
            <div style="font-size:10px;margin-top:6px;color:#d1d5db;">${escapeHtml(call.location_address || '')}</div>
            <div style="margin-top:8px;padding-top:6px;border-top:1px solid #1e3048;">
              <div style="display:flex;gap:12px;font-size:9px;color:#5a6e80;">
                <div><span style="color:#9ca3af;font-weight:bold;">Response:</span> ${escapeHtml(formatResponseTime(call.response_time_min))}</div>
              </div>
              ${call.assigned_units ? `<div style="font-size:9px;color:#60a5fa;margin-top:4px;font-weight:bold;">${escapeHtml(call.assigned_units)}</div>` : ''}
              <div style="font-size:8px;color:#4b5563;margin-top:4px;">
                ${escapeHtml(formatTimestamp(call.created_at))} &rarr; ${escapeHtml(formatTimestamp(call.cleared_at))}
              </div>
            </div>
            ${call.description ? `<div style="font-size:9px;color:#6b7280;margin-top:6px;padding-top:4px;border-top:1px solid #1e3048;max-height:40px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(call.description.substring(0, 150))}</div>` : ''}
            ${call.source ? `<div style="margin-top:4px;"><span style="font-size:8px;color:#5a6e80;padding:1px 4px;background:#1e304830;border:1px solid #1e304860;border-radius:2px;">${escapeHtml(getSourceLabel(call.source))}</span></div>` : ''}
          </div>
        `);
        infoWindowRef.current?.setPosition({ lat: call.latitude, lng: call.longitude });
        infoWindowRef.current?.open(map);
      });

      markersRef.current.push(marker);
    });
  }, [map, clearMarkers]);

  // ── Fetch & render on filter change ─────────────────────

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
      .catch(() => {
        if (cancelled) return;
        setCalls([]);
        clearMarkers();
        setLoading(false);
      });

    return () => { cancelled = true; };
  // Memoize join strings to stabilize dependency references
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled, days, statuses.join(','), types.join(','), priorities.join(','), clearMarkers, renderMarkers]);

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => { m.map = null; });
      markersRef.current = [];
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
        infoWindowRef.current = null;
      }
    };
  }, []);

  return { calls, loading, count: calls.length };
}
