// ============================================================
// RMPG Flex — useMapPatrolCheckpoints Hook
// Patrol checkpoint overlay with color-coded scan status
// and dashed route polylines per property.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { getOverlayMarkerClass } from '../utils/mapMarkerBuilders';

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
  scan_count?: number;
}

interface UseMapPatrolCheckpointsReturn {
  checkpoints: CheckpointRecord[];
  loading: boolean;
  overdueCount: number;
  completionPct: number; // Fix 82: completion percentage
}

// ─── Status color logic ─────────────────────────────────────

type ScanStatus = 'green' | 'amber' | 'red';

function getHoursSinceLastScan(checkpoint: CheckpointRecord): number {
  if (!checkpoint.last_scanned) return Infinity;
  const lastScan = new Date(checkpoint.last_scanned).getTime();
  if (isNaN(lastScan)) return Infinity;
  return (Date.now() - lastScan) / (1000 * 60 * 60);
}

function getScanStatus(checkpoint: CheckpointRecord): ScanStatus {
  const hours = getHoursSinceLastScan(checkpoint);
  // Time-based thresholds: green <1hr, amber <4hr, red >=4hr
  if (hours < 1) return 'green';
  if (hours < 4) return 'amber';
  return 'red';
}

function isOverdue(checkpoint: CheckpointRecord): boolean {
  return getHoursSinceLastScan(checkpoint) >= 4;
}

const STATUS_COLORS: Record<ScanStatus, string> = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#dc2626',
};

// ─── Create marker HTML element using DOM API ───────────────

// Inject pulse keyframes for overdue checkpoints (once)
let pulseInjected = false;
function injectCheckpointPulse() {
  if (pulseInjected) return;
  pulseInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes checkpoint-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.6); }
      50% { box-shadow: 0 0 0 8px rgba(220,38,38,0); }
    }
  `;
  document.head.appendChild(style);
}

function createCheckpointMarkerElement(status: ScanStatus, overdue: boolean, scanCount?: number): HTMLDivElement {
  const color = STATUS_COLORS[status];

  if (overdue) injectCheckpointPulse();

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:inline-flex;';

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
    ${overdue ? 'animation: checkpoint-pulse 1.5s ease-in-out infinite;' : ''}
  `;

  const label = document.createElement('span');
  label.style.cssText = 'color: white; font-size: 11px; font-weight: bold; line-height: 1;';
  label.textContent = '\u2713'; // checkmark
  el.appendChild(label);

  wrapper.appendChild(el);

  // Check count badge
  if (scanCount != null && scanCount > 0) {
    const badge = document.createElement('div');
    badge.style.cssText = `
      position: absolute;
      top: -6px;
      right: -8px;
      background: #181818;
      color: ${color};
      font-size: 8px;
      font-weight: bold;
      font-family: monospace;
      min-width: 14px;
      height: 14px;
      border-radius: 7px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid ${color};
      padding: 0 2px;
      line-height: 1;
    `;
    badge.textContent = String(scanCount);
    wrapper.appendChild(badge);
  }

  return wrapper;
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
  if (cp.scan_count != null) {
    addRow('Total Scans', String(cp.scan_count));
  }

  const hours = getHoursSinceLastScan(cp);
  const hoursLabel = hours === Infinity ? '' : ` (${hours.toFixed(1)}h ago)`;
  const statusLabel = status === 'green' ? 'ON TIME' : status === 'amber' ? 'DUE SOON' : 'OVERDUE';
  addRow('Status', `${statusLabel}${hoursLabel}`, color);

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

  const markersRef = useRef<google.maps.OverlayView[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Clear all map objects ─────────────────────────────────

  const clearAll = useCallback(() => {
    markersRef.current.forEach((m) => {
      m.setMap(null);
    });
    markersRef.current = [];
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
  }, []);

  // ── Render checkpoints on map ─────────────────────────────

  const renderCheckpoints = useCallback((data: CheckpointRecord[]) => {
    const OverlayMarkerClass = getOverlayMarkerClass();
    if (!map || !OverlayMarkerClass) return;

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

      const content = createCheckpointMarkerElement(status, isOverdue(cp), cp.scan_count);

      const marker = new OverlayMarkerClass({
        map,
        position: { lat, lng },
        content,
        title: `${cp.name} (${cp.property_name || 'Unknown'})`,
        zIndex: 15,
        onClick: () => {
          const infoContent = buildCheckpointInfoContent(cp, status);
          infoWindowRef.current?.setContent(infoContent);
          infoWindowRef.current?.setPosition({ lat, lng });
          infoWindowRef.current?.open(map);
        },
      });

      markersRef.current.push(marker as unknown as google.maps.OverlayView);
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
        strokeColor: '#aaaaaa',
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
      .catch((err) => {
        console.warn('[useMapPatrolCheckpoints] Checkpoints fetch failed:', err);
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
      markersRef.current.forEach((m) => { m.setMap(null); });
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

  // Fix 82: calculate completion percentage
  const completionPct = checkpoints.length > 0
    ? Math.round(((checkpoints.length - overdueCount) / checkpoints.length) * 100)
    : 0;

  return { checkpoints, loading, overdueCount, completionPct };
}
