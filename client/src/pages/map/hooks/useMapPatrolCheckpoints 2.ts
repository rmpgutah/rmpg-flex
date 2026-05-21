import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { getOverlayMarkerClass } from '../utils/mapMarkerBuilders';

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
  completionPct: number;
}

type ScanStatus = 'green' | 'amber' | 'red';

function getHoursSinceLastScan(checkpoint: CheckpointRecord): number {
  if (!checkpoint.last_scanned) return Infinity;
  const lastScan = new Date(checkpoint.last_scanned).getTime();
  if (isNaN(lastScan)) return Infinity;
  return (Date.now() - lastScan) / (1000 * 60 * 60);
}

function getScanStatus(checkpoint: CheckpointRecord): ScanStatus {
  const hours = getHoursSinceLastScan(checkpoint);
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
  label.textContent = '\u2713';
  el.appendChild(label);
  wrapper.appendChild(el);

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

function buildCheckpointInfoContent(cp: CheckpointRecord, status: ScanStatus): string {
  const color = STATUS_COLORS[status];
  const hours = getHoursSinceLastScan(cp);
  const hoursLabel = hours === Infinity ? '' : ` (${hours.toFixed(1)}h ago)`;
  const statusLabel = status === 'green' ? 'ON TIME' : status === 'amber' ? 'DUE SOON' : 'OVERDUE';

  return `
    <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#0d0d0d;padding:10px 12px;border-radius:4px;border:1px solid #282828">
      <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">Checkpoint: ${cp.name}</div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        ${cp.property_name ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Property</td><td style="color:#e0e0e0">${cp.property_name}</td></tr>` : ''}
        <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Interval</td><td style="color:#e0e0e0">${cp.scan_required_interval_minutes} min</td></tr>
        <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Last Scan</td><td style="color:${cp.last_scanned ? '#e0e0e0' : '#dc2626'}">${cp.last_scanned ? new Date(cp.last_scanned).toLocaleString() : 'Never'}</td></tr>
        ${cp.scanned_by_name ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Scanned By</td><td style="color:#e0e0e0">${cp.scanned_by_name}</td></tr>` : ''}
        ${cp.scan_count != null ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Total Scans</td><td style="color:#e0e0e0">${cp.scan_count}</td></tr>` : ''}
        <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Status</td><td style="color:${color}">${statusLabel}${hoursLabel}</td></tr>
      </table>
    </div>
  `;
}

export function useMapPatrolCheckpoints(
  map: mapboxgl.Map | null,
  enabled: boolean,
): UseMapPatrolCheckpointsReturn {
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);

  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sourceId = 'patrol-checkpoints';
  const routeSourceId = 'patrol-checkpoint-routes';

  const clearAll = useCallback(() => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (map) {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      if (map.getLayer(routeSourceId)) map.removeLayer(routeSourceId);
      if (map.getSource(routeSourceId)) map.removeSource(routeSourceId);
    }
  }, [map]);

  const renderCheckpoints = useCallback((data: CheckpointRecord[]) => {
    if (!map) return;

    clearAll();

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const withCoords = data.filter(
      (cp) => cp.latitude != null && cp.longitude != null && !isNaN(Number(cp.latitude)) && !isNaN(Number(cp.longitude))
    );

    let overdue = 0;
    withCoords.forEach((cp) => {
      if (getScanStatus(cp) === 'red') overdue++;
    });
    setOverdueCount(overdue);

    const markerFeatures: any[] = [];
    const routeFeatures: any[] = [];

    withCoords.forEach((cp) => {
      const lat = Number(cp.latitude);
      const lng = Number(cp.longitude);
      const status = getScanStatus(cp);

      markerFeatures.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
        properties: { id: cp.id, status, name: cp.name, propertyName: cp.property_name, scanCount: cp.scan_count },
      });
    });

    const byProperty = new Map<number, CheckpointRecord[]>();
    withCoords.forEach((cp) => {
      const existing = byProperty.get(cp.property_id) || [];
      existing.push(cp);
      byProperty.set(cp.property_id, existing);
    });

    byProperty.forEach((cps) => {
      if (cps.length < 2) return;
      const sorted = [...cps].sort((a, b) => a.sequence_order - b.sequence_order);
      const coords = sorted.map((cp) => [Number(cp.longitude), Number(cp.latitude)] as [number, number]);
      routeFeatures.push({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: coords },
        properties: {},
      });
    });

    if (markerFeatures.length > 0) {
      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: markerFeatures } });
      map.addLayer({
        id: sourceId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-color': [
            'case',
            ['==', ['get', 'status'], 'red'], '#dc2626',
            ['==', ['get', 'status'], 'amber'], '#f59e0b',
            '#22c55e',
          ],
          'circle-radius': 8,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });

      map.on('click', sourceId, (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties;
        const cp = withCoords.find(c => c.id === props?.id);
        if (!cp) return;
        const status = getScanStatus(cp);
        if (popupRef.current) {
          popupRef.current.setLngLat([cp.longitude!, cp.latitude!]).setHTML(buildCheckpointInfoContent(cp, status)).addTo(map);
        }
      });
    }

    if (routeFeatures.length > 0) {
      map.addSource(routeSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: routeFeatures } });
      map.addLayer({
        id: routeSourceId,
        type: 'line',
        source: routeSourceId,
        paint: {
          'line-color': '#aaaaaa',
          'line-width': 2,
          'line-dasharray': [2, 3],
          'line-opacity': 0.6,
        },
      });
    }
  }, [map, clearAll]);

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

  useEffect(() => {
    if (!map) return;

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
    intervalRef.current = setInterval(fetchData, 60_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [map, enabled, fetchData, clearAll]);

  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => { m.remove(); });
      markersRef.current = [];
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const completionPct = checkpoints.length > 0
    ? Math.round(((checkpoints.length - overdueCount) / checkpoints.length) * 100)
    : 0;

  return { checkpoints, loading, overdueCount, completionPct };
}
