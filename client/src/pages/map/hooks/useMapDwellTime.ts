import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

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

const REFRESH_MS = 30_000;

export function useMapDwellTime(
  map: mapboxgl.Map | null,
  _units: Array<{ call_sign: string; latitude?: number; longitude?: number; status?: string }>,
  enabled: boolean,
): UseMapDwellTimeReturn {
  const [dwellData, setDwellData] = useState<DwellTimeRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const sourceId = 'dwell-time';
  const pulseIntervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);

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

  useEffect(() => {
    if (!map) return;

    if (map.getLayer(sourceId)) map.removeLayer(sourceId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    pulseIntervalsRef.current.forEach((id) => clearInterval(id));
    pulseIntervalsRef.current = [];

    if (!enabled || dwellData.length === 0) return;

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const features = dwellData
      .filter((record) => record.latitude != null && record.longitude != null && isFinite(record.latitude) && isFinite(record.longitude))
      .map((record) => {
        const tier = getTier(record.dwell_minutes);
        const scaledRadius = tier ? Math.max(tier.radius, Math.min(250, tier.radius + record.dwell_minutes * 0.5)) : 50;
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [record.longitude, record.latitude] as [number, number] },
          properties: {
            call_sign: record.call_sign,
            status: record.status,
            dwell_minutes: record.dwell_minutes,
            tierColor: tier?.color || '#666666',
            tierRadius: scaledRadius,
            tierStrokeWeight: tier?.strokeWeight || 1,
            tierPulse: tier?.pulse || false,
          },
        };
      });

    if (features.length === 0) return;

    map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: sourceId,
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-color': ['get', 'tierColor'],
        'circle-radius': ['get', 'tierRadius'],
        'circle-opacity': 0.08,
        'circle-stroke-color': ['get', 'tierColor'],
        'circle-stroke-width': ['get', 'tierStrokeWeight'],
        'circle-stroke-opacity': 0.7,
      },
    });

    map.on('click', sourceId, (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;
      const p = feature.properties;
      const tier = getTier(p.dwell_minutes as number);
      const color = tier?.color || '#666666';
      const hours = Math.floor(p.dwell_minutes as number / 60);
      const mins = Math.round(p.dwell_minutes as number % 60);
      const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

      const html = `
        <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:180px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
          <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">Dwell Time \u2014 ${p.call_sign}</div>
          <table style="width:100%;font-size:11px;border-collapse:collapse">
            <tr><td style="color:#888888;padding:1px 6px 1px 0">Duration</td><td style="color:${color}">${durationStr}</td></tr>
            <tr><td style="color:#888888;padding:1px 6px 1px 0">Status</td><td style="color:#e0e0e0">${p.status}</td></tr>
            <tr><td style="color:#888888;padding:1px 6px 1px 0">Unit</td><td style="color:#e0e0e0">${p.call_sign}</td></tr>
          </table>
        </div>
      `;
      if (popupRef.current) {
        popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
      }
    });

    return () => {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      pulseIntervalsRef.current.forEach((id) => clearInterval(id));
      pulseIntervalsRef.current = [];
    };
  }, [map, enabled, dwellData]);

  useEffect(() => {
    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, []);

  const dwellAlertCount = dwellData.filter((d) => d.dwell_minutes > 15).length;

  return { dwellAlertCount, loading };
}
