// ============================================================
// RMPG Flex — useMapFieldInterviews Hook
// Field interview pins with diamond-shaped markers
// color-coded by contact reason.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

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

// ─── Contact reason colors ──────────────────────────────────

const REASON_COLORS: Record<string, string> = {
  trespass: '#f59e0b',
  suspicious: '#dc2626',
  welfare: '#3b82f6',
};

function getReasonColor(reason: string): string {
  return REASON_COLORS[reason?.toLowerCase()] || '#6b7280';
}

// ─── Create diamond-shaped marker ───────────────────────────

function createDiamondMarker(reason: string): HTMLDivElement {
  const color = getReasonColor(reason);

  const el = document.createElement('div');
  el.style.cssText = `
    width: 20px;
    height: 20px;
    background: ${color};
    transform: rotate(45deg);
    border: 2px solid white;
    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
    cursor: pointer;
  `;

  return el;
}

// ─── Build info window content ──────────────────────────────

function buildFIInfoContent(fi: FIRecord): HTMLDivElement {
  const color = getReasonColor(fi.contact_reason);

  const container = document.createElement('div');
  container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:4px;border:1px solid #1e2a3a';

  const heading = document.createElement('div');
  heading.style.cssText = `font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}`;
  heading.textContent = `Field Interview ${fi.fi_number}`;
  container.appendChild(heading);

  const table = document.createElement('table');
  table.style.cssText = 'width:100%;font-size:11px;border-collapse:collapse';

  const addRow = (lbl: string, value: unknown) => {
    if (value == null || value === '') return;
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.style.cssText = 'color:#6b7b8d;padding:1px 6px 1px 0';
    tdLabel.textContent = lbl;
    const tdValue = document.createElement('td');
    tdValue.style.cssText = 'color:#e0e0e0';
    tdValue.textContent = String(value);
    tr.appendChild(tdLabel);
    tr.appendChild(tdValue);
    table.appendChild(tr);
  };

  const name = [fi.subject_first_name, fi.subject_last_name].filter(Boolean).join(' ');
  addRow('Subject', name || 'Unknown');
  addRow('Reason', fi.contact_reason);
  addRow('Action', fi.action_taken);
  addRow('Officer', fi.officer_name);
  addRow('Location', fi.location);
  addRow('Date', fi.created_at ? new Date(fi.created_at).toLocaleString() : undefined);

  container.appendChild(table);
  return container;
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapFieldInterviews(
  map: google.maps.Map | null,
  enabled: boolean,
  days: number = 30,
): UseMapFieldInterviewsReturn {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // ── Clear markers ─────────────────────────────────────────

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((m) => { m.map = null; });
    markersRef.current = [];
  }, []);

  // ── Render markers ────────────────────────────────────────

  const renderMarkers = useCallback((records: FIRecord[]) => {
    if (!map || !window.google?.maps?.marker?.AdvancedMarkerElement) return;

    clearMarkers();

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    const withCoords = records.filter(
      (fi) => fi.latitude != null && fi.longitude != null && !isNaN(Number(fi.latitude)) && !isNaN(Number(fi.longitude))
    );

    setCount(withCoords.length);

    withCoords.forEach((fi) => {
      const lat = Number(fi.latitude);
      const lng = Number(fi.longitude);

      const content = createDiamondMarker(fi.contact_reason);

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat, lng },
        content,
        title: `FI ${fi.fi_number}`,
        zIndex: 18,
      });

      marker.addListener('click', () => {
        const infoContent = buildFIInfoContent(fi);
        infoWindowRef.current?.setContent(infoContent);
        infoWindowRef.current?.setPosition({ lat, lng });
        infoWindowRef.current?.open(map);
      });

      markersRef.current.push(marker);
    });
  }, [map, clearMarkers]);

  // ── Fetch and render ──────────────────────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

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
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [map, enabled, days, clearMarkers, renderMarkers]);

  // ── Cleanup on unmount ────────────────────────────────────

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

  return { count, loading };
}
