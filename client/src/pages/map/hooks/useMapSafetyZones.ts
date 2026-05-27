import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { whenStyleReady } from '../utils/safeAddSource';

export interface SafetyZone {
  latitude: number;
  longitude: number;
  risk_level: 'high' | 'moderate';
  weapons_count: number;
  dv_count: number;
  injuries_count: number;
  total_flagged: number;
  last_incident: string;
  incident_types?: string;
}

interface UseMapSafetyZonesReturn {
  zones: SafetyZone[];
  loading: boolean;
  refresh: () => void;
  days: number;
  setDays: (d: number) => void;
}

export function useMapSafetyZones(
  map: mapboxgl.Map | null,
  enabled: boolean,
): UseMapSafetyZonesReturn {
  const [zones, setZones] = useState<SafetyZone[]>([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(90);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const sourceId = 'safety-zones';
  const pulseIntervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);

  const refresh = useCallback(() => setFetchTrigger(n => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setZones([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiFetch<{ zones: SafetyZone[]; total: number } | SafetyZone[]>(`/dispatch/heatmap/safety-zones?days=${days}`)
      .then((data) => {
        if (cancelled) return;
        const zoneList = Array.isArray(data) ? data : (data?.zones || []);
        setZones(zoneList);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[SafetyZones] Fetch error:', err);
        setZones([]);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [enabled, days, fetchTrigger]);

  useEffect(() => {
    if (!map) return;

    if (map.getLayer(sourceId)) map.removeLayer(sourceId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    pulseIntervalsRef.current.forEach((id) => clearInterval(id));
    pulseIntervalsRef.current = [];

    if (!enabled || zones.length === 0) return;

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const features = zones
      .filter((zone) => zone.latitude != null && zone.longitude != null && isFinite(zone.latitude) && isFinite(zone.longitude))
      .map((zone) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [zone.longitude, zone.latitude] as [number, number] },
        properties: {
          isHigh: zone.risk_level === 'high',
          weapons_count: zone.weapons_count,
          dv_count: zone.dv_count,
          injuries_count: zone.injuries_count,
          total_flagged: zone.total_flagged,
          last_incident: zone.last_incident,
        },
      }));

    if (features.length === 0) return;

    whenStyleReady(map, () => {
      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: sourceId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-color': ['case', ['get', 'isHigh'], '#dc2626', '#f59e0b'],
          'circle-radius': ['case', ['get', 'isHigh'], 20, 15],
          'circle-opacity': [
            'interpolate', ['linear'], ['get', 'total_flagged'],
            0, 0.06,
            20, 0.21,
          ],
          'circle-stroke-color': ['case', ['get', 'isHigh'], '#dc2626', '#f59e0b'],
          'circle-stroke-width': ['case', ['get', 'isHigh'], 3, 2],
          'circle-stroke-opacity': [
            'interpolate', ['linear'], ['get', 'total_flagged'],
            0, 0.3,
            20, 0.7,
          ],
        },
      });

      map.on('click', sourceId, (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;
      const p = feature.properties;
      const isHigh = p.isHigh as boolean;
      const color = isHigh ? '#dc2626' : '#f59e0b';
      const riskLabel = isHigh ? 'HIGH' : 'MODERATE';
      const lastDate = p.last_incident ? new Date(p.last_incident as string).toLocaleDateString() : 'Unknown';

      const html = `
        <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
          <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">${riskLabel} Risk Zone</div>
          <table style="width:100%;font-size:11px;border-collapse:collapse">
            <tr><td style="color:#888888;padding:1px 6px 1px 0">Weapons</td><td style="color:#ef4444">${p.weapons_count}</td></tr>
            <tr><td style="color:#888888;padding:1px 6px 1px 0">DV Incidents</td><td style="color:#f59e0b">${p.dv_count}</td></tr>
            <tr><td style="color:#888888;padding:1px 6px 1px 0">Injuries</td><td style="color:#fb923c">${p.injuries_count}</td></tr>
            <tr><td style="color:#888888;padding:1px 6px 1px 0">Total Flagged</td><td style="color:#e0e0e0">${p.total_flagged}</td></tr>
            <tr><td style="color:#888888;padding:1px 6px 1px 0">Last Incident</td><td style="color:#e0e0e0">${lastDate}</td></tr>
          </table>
        </div>
      `;
      if (popupRef.current) {
        popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
      }
      });
    });

    return () => {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      pulseIntervalsRef.current.forEach((id) => clearInterval(id));
      pulseIntervalsRef.current = [];
    };
  }, [map, enabled, zones]);

  useEffect(() => {
    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, []);

  return { zones, loading, refresh, days, setDays };
}
