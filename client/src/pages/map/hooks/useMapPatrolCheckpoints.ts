// ============================================================
// RMPG Flex — useMapPatrolCheckpoints Hook
// Patrol checkpoint overlay with color-coded scan status
// and dashed route polylines per property.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

interface CheckpointRecord {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  property_id: number;
  property_name: string | null;
  sequence_order: number;
  scan_required_interval_minutes: number;
  last_scanned: string | null;
  scanned_by_name: string | null;
}

interface UseMapPatrolCheckpointsReturn {
  checkpoints: CheckpointRecord[];
  loading: boolean;
  overdueCount: number;
}

// ─── Status color logic ─────────────────────────────────────

type ScanStatus = 'green' | 'amber' | 'red';

function getScanStatus(checkpoint: CheckpointRecord): ScanStatus {
  if (!checkpoint.last_scanned) return 'red';

  const lastScan = new Date(checkpoint.last_scanned).getTime();
  const now = Date.now();
  const elapsedMs = now - lastScan;
  const intervalMs = checkpoint.scan_required_interval_minutes * 60 * 1000;

  if (elapsedMs >= intervalMs) return 'red';
  if (elapsedMs >= intervalMs * 0.5) return 'amber';
  return 'green';
}

const STATUS_COLORS: Record<ScanStatus, string> = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#dc2626',
};

// ─── Create marker HTML element using DOM API ───────────────

function createCheckpointMarkerElement(status: ScanStatus): HTMLDivElement {
  const color = STATUS_COLORS[status];

  const el = document.createElement('div');
  el.style.cssText = `
    background: ${color};
    width: 22px;
    height: 22px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid white;
    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
    cursor: pointer;
  `;

  const label = document.createElement('span');
  label.style.cssText = 'color: white; font-size: 11px; font-weight: bold; line-height: 1;';
  label.textContent = '\u2713'; // checkmark
  el.appendChild(label);

  return el;
}

// ─── Build info window content ──────────────────────────────

function buildCheckpointInfoContent(cp: CheckpointRecord, status: ScanStatus): HTMLDivElement {
  const color = STATUS_COLORS[status];

  const container = document.createElement('div');
  container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:4px;border:1px solid #1e2a3a';

  const heading = document.createElement('div');
  heading.style.cssText = `font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}`;
  heading.textContent = `Checkpoint: ${cp.name}`;
  container.appendChild(heading);

  const table = document.createElement('table');
  table.style.cssText = 'width:100%;font-size:11px;border-collapse:collapse';

  const addRow = (lbl: string, value: unknown, valColor?: string) => {
    if (value == null || value === '') return;
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.style.cssText = 'color:#6b7b8d;padding:1px 6px 1px 0';
    tdLabel.textContent = lbl;
    const tdValue = document.createElement('td');
    tdValue.style.cssText = `color:${valColor || '#e0e0e0'}`;
    tdValue.textContent = String(value);
    tr.appendChild(tdLabel);
    tr.appendChild(tdValue);
    table.appendChild(tr);
  };

  addRow('Property', cp.property_name);
  addRow('Interval', `${cp.scan_required_interval_minutes} min`);
  addRow('Last Scan', cp.last_scanned ? new Date(cp.last_scanned).toLocaleString() : 'Never', cp.last_scanned ? undefined : '#dc2626');
  addRow('Scanned By', cp.scanned_by_name);

  const statusLabel = status === 'green' ? 'ON TIME' : status === 'amber' ? 'DUE SOON' : 'OVERDUE';
  addRow('Status', statusLabel, color);

  container.appendChild(table);
  return container;
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapPatrolCheckpoints(
  map: google.maps.Map | null,
  enabled: boolean,
): UseMapPatrolCheckpointsReturn {
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);

  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Clear all map objects ─────────────────────────────────

  const clearAll = useCallback(() => {
    markersRef.current.forEach((m) => {
      if (window.google?.maps?.event) google.maps.event.clearInstanceListeners(m);
      m.map = null;
    });
    markersRef.current = [];
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
  }, []);

  // ── Render checkpoints on map ─────────────────────────────

  const renderCheckpoints = useCallback((data: CheckpointRecord[]) => {
    if (!map || !window.google?.maps?.marker?.AdvancedMarkerElement) return;

    clearAll();

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    const withCoords = data.filter(
      (cp) => cp.latitude != null && cp.longitude != null && !isNaN(Number(cp.latitude)) && !isNaN(Number(cp.longitude))
    );

    // Count overdue
    let overdue = 0;
    withCoords.forEach((cp) => {
      if (getScanStatus(cp) === 'red') overdue++;
    });
    setOverdueCount(overdue);

    // Create markers
    withCoords.forEach((cp) => {
      const lat = Number(cp.latitude);
      const lng = Number(cp.longitude);
      const status = getScanStatus(cp);

      const content = createCheckpointMarkerElement(status);

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat, lng },
        content,
        title: `${cp.name} (${cp.property_name || 'Unknown'})`,
        zIndex: 15,
      });

      marker.addListener('click', () => {
        const infoContent = buildCheckpointInfoContent(cp, status);
        infoWindowRef.current?.setContent(infoContent);
        infoWindowRef.current?.setPosition({ lat, lng });
        infoWindowRef.current?.open(map);
      });

      markersRef.current.push(marker);
    });

    // Draw dashed polylines per property (connecting checkpoints in sequence order)
    const byProperty = new Map<number, CheckpointRecord[]>();
    withCoords.forEach((cp) => {
      const existing = byProperty.get(cp.property_id) || [];
      existing.push(cp);
      byProperty.set(cp.property_id, existing);
    });

    byProperty.forEach((cps) => {
      if (cps.length < 2) return;

      const sorted = [...cps].sort((a, b) => a.sequence_order - b.sequence_order);
      const path = sorted.map((cp) => ({ lat: Number(cp.latitude), lng: Number(cp.longitude) }));

      const polyline = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: '#60a5fa',
        strokeOpacity: 0,
        strokeWeight: 2,
        map,
        zIndex: 10,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.6, scale: 2 },
          offset: '0',
          repeat: '12px',
        }],
      });

      polylinesRef.current.push(polyline);
    });
  }, [map, clearAll]);

  // ── Fetch data ────────────────────────────────────────────

  const fetchData = useCallback(() => {
    if (!enabled) return;

    let cancelled = false;
    setLoading(true);
    apiFetch<CheckpointRecord[]>('/patrol/checkpoints/map')
      .then((data) => {
        if (cancelled) return;
        const records = Array.isArray(data) ? data : [];
        setCheckpoints(records);
        renderCheckpoints(records);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [enabled, renderCheckpoints]);

  // ── Effect: fetch + auto-refresh ──────────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (!enabled) {
      clearAll();
      setCheckpoints([]);
      setOverdueCount(0);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    fetchData();

    // Refresh every 60 seconds
    intervalRef.current = setInterval(fetchData, 60_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [map, enabled, fetchData, clearAll]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => { m.map = null; });
      markersRef.current = [];
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
        infoWindowRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return { checkpoints, loading, overdueCount };
}
