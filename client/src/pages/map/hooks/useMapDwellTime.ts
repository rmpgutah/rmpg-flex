// ============================================================
// RMPG Flex — useMapDwellTime Hook
// Unit dwell time halos: color-coded rings around units that
// have been stationary for extended periods.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

interface DwellTimeRecord {
  call_sign: string;
  latitude: number;
  longitude: number;
  dwell_minutes: number;
  status: string;
}

interface UseMapDwellTimeReturn {
  dwellAlertCount: number;
  loading: boolean;
}

// ─── Dwell tier config ──────────────────────────────────────

interface DwellTier {
  minMinutes: number;
  maxMinutes: number;
  color: string;
  radius: number;
  strokeWeight: number;
  pulse: boolean;
}

const DWELL_TIERS: DwellTier[] = [
  { minMinutes: 60, maxMinutes: Infinity, color: '#dc2626', radius: 160, strokeWeight: 3, pulse: true },
  { minMinutes: 30, maxMinutes: 60,       color: '#f97316', radius: 120, strokeWeight: 2, pulse: false },
  { minMinutes: 15, maxMinutes: 30,       color: '#f59e0b', radius: 80,  strokeWeight: 2, pulse: false },
  { minMinutes: 5,  maxMinutes: 15,       color: '#22c55e', radius: 50,  strokeWeight: 1, pulse: false },
];

function getTier(minutes: number): DwellTier | null {
  return DWELL_TIERS.find((t) => minutes >= t.minMinutes && minutes < t.maxMinutes) || null;
}

function circleToPolygon(center: [number, number], radiusM: number, segments = 32): [number, number][] {
  const coords: [number, number][] = [];
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center[1] * Math.PI / 180);
  const dLat = radiusM / metersPerDegLat;
  const dLng = radiusM / metersPerDegLng;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    coords.push([center[0] + dLng * Math.cos(angle), center[1] + dLat * Math.sin(angle)]);
  }
  return coords;
}

// ─── Refresh interval ───────────────────────────────────────

const REFRESH_MS = 30_000;

// ─── Hook ───────────────────────────────────────────────────

export function useMapDwellTime(
  map: mapboxgl.Map | null,
  _units: Array<{ call_sign: string; latitude?: number; longitude?: number; status?: string }>,
  enabled: boolean,
): UseMapDwellTimeReturn {
  const [dwellData, setDwellData] = useState<DwellTimeRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const layerIdsRef = useRef<string[]>([]);
  const sourceIdsRef = useRef<string[]>([]);
  const pulseIntervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  function removeDwellLayers() {
    if (!map) return;
    layerIdsRef.current.forEach((id) => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ignore */ }
    });
    sourceIdsRef.current.forEach((id) => {
      try { if (map.getSource(id)) map.removeSource(id); } catch { /* ignore */ }
    });
    layerIdsRef.current = [];
    sourceIdsRef.current = [];
    pulseIntervalsRef.current.forEach((id) => clearInterval(id));
    pulseIntervalsRef.current = [];
    popupRef.current?.remove();
    popupRef.current = null;
  }

  // ── Fetch dwell times ─────────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      setDwellData([]);
      return;
    }

    let cancelled = false;

    const fetchDwell = () => {
      setLoading(true);
      apiFetch<DwellTimeRecord[]>('/dispatch/gps/dwell-times')
        .then((data) => {
          if (!cancelled) {
            setDwellData(data || []);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('[useMapDwellTime] Dwell time fetch failed:', err);
            setDwellData([]);
            setLoading(false);
          }
        });
    };

    fetchDwell();
    const interval = setInterval(fetchDwell, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  // ── Render circles ────────────────────────────────────────

  useEffect(() => {
    removeDwellLayers();

    if (!map || !enabled || dwellData.length === 0) return;

    dwellData.forEach((record) => {
      if (record.latitude == null || record.longitude == null) return;
      if (!isFinite(record.latitude) || !isFinite(record.longitude)) return;

      const tier = getTier(record.dwell_minutes);
      if (!tier) return;

      const scaledRadius = Math.max(tier.radius, Math.min(250, tier.radius + record.dwell_minutes * 0.5));

      const sourceId = `dwell-source-${record.call_sign}-${record.latitude}-${record.longitude}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const layerId = `dwell-layer-${record.call_sign}-${record.latitude}-${record.longitude}`.replace(/[^a-zA-Z0-9_-]/g, '_');

      const poly = circleToPolygon([record.longitude, record.latitude], scaledRadius);
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [poly] } }] },
      });
      map.addLayer({
        id: layerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': tier.color,
          'fill-opacity': 0.08,
          'fill-outline-color': tier.color,
        },
      });

      sourceIdsRef.current.push(sourceId);
      layerIdsRef.current.push(layerId);

      // Info window on click
      map.on('click', layerId, () => {
        const hours = Math.floor(record.dwell_minutes / 60);
        const mins = Math.round(record.dwell_minutes % 60);
        const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
        const container = document.createElement('div');
        container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:180px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222';
        const heading = document.createElement('div');
        heading.style.cssText = `font-weight:bold;font-size:13px;margin-bottom:6px;color:${tier.color}`;
        heading.textContent = `Dwell Time — ${record.call_sign}`;
        container.appendChild(heading);
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;font-size:11px;border-collapse:collapse';
        const addRow = (lbl: string, val: string, color?: string) => {
          const tr = document.createElement('tr');
          const td1 = document.createElement('td');
          td1.style.cssText = 'color:#888888;padding:1px 6px 1px 0';
          td1.textContent = lbl;
          const td2 = document.createElement('td');
          td2.style.cssText = `color:${color || '#e0e0e0'}`;
          td2.textContent = val;
          tr.appendChild(td1); tr.appendChild(td2); table.appendChild(tr);
        };
        addRow('Duration', durationStr, tier.color);
        addRow('Status', record.status);
        addRow('Unit', record.call_sign);
        container.appendChild(table);

        popupRef.current?.remove();
        popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', offset: 15 })
          .setLngLat([record.longitude, record.latitude])
          .setDOMContent(container)
          .addTo(map);
      });

      // Pulsing effect for 60+ min dwell
      if (tier.pulse) {
        let opacity = 0.7;
        let direction = -1;
        const pulseInterval = setInterval(() => {
          opacity += direction * 0.05;
          if (opacity <= 0.2) { opacity = 0.2; direction = 1; }
          if (opacity >= 0.9) { opacity = 0.9; direction = -1; }
          if (map && map.getLayer(layerId)) {
            map.setPaintProperty(layerId, 'fill-opacity', opacity);
          }
        }, 500);
        pulseIntervalsRef.current.push(pulseInterval);
      }
    });

    return () => {
      removeDwellLayers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled, dwellData]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      removeDwellLayers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dwellAlertCount = dwellData.filter((d) => d.dwell_minutes > 15).length;

  return { dwellAlertCount, loading };
}
