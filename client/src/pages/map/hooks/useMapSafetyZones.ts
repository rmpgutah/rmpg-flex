// ============================================================
// RMPG Flex — useMapSafetyZones Hook
// Auto-generated danger zone overlays based on incident data
// showing high and moderate risk areas.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

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

// ─── Hook ───────────────────────────────────────────────────

export function useMapSafetyZones(
  map: mapboxgl.Map | null,
  enabled: boolean,
): UseMapSafetyZonesReturn {
  const [zones, setZones] = useState<SafetyZone[]>([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(90);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const layerIdsRef = useRef<string[]>([]);
  const sourceIdsRef = useRef<string[]>([]);
  const pulseIntervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const refresh = useCallback(() => setFetchTrigger(n => n + 1), []);

  function removeZoneLayers() {
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

  // ── Fetch safety zones ──────────────────────────────────

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

  // ── Render circles ──────────────────────────────────────

  useEffect(() => {
    removeZoneLayers();

    if (!map || !enabled || zones.length === 0) return;

    zones.forEach((zone, index) => {
      if (zone.latitude == null || zone.longitude == null) return;
      if (!isFinite(zone.latitude) || !isFinite(zone.longitude)) return;

      const isHigh = zone.risk_level === 'high';
      const color = isHigh ? '#dc2626' : '#f59e0b';
      const radius = isHigh ? 200 : 150;
      const severity = Math.min(1, zone.total_flagged / 20);
      const fillOpacity = 0.06 + severity * 0.15;
      const strokeOpacity = 0.3 + severity * 0.4;

      const sourceId = `safety-source-${index}`;
      const layerId = `safety-layer-${index}`;

      const poly = circleToPolygon([zone.longitude, zone.latitude], radius);
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [poly] } }] },
      });
      map.addLayer({
        id: layerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': color,
          'fill-opacity': fillOpacity,
          'fill-outline-color': color,
        },
      });

      sourceIdsRef.current.push(sourceId);
      layerIdsRef.current.push(layerId);

      // Pulsing border on high-risk zones
      if (isHigh) {
        let pulseOp = fillOpacity;
        let dir = -1;
        const pulseInterval = setInterval(() => {
          pulseOp += dir * 0.04;
          if (pulseOp <= 0.2) { pulseOp = 0.2; dir = 1; }
          if (pulseOp >= 0.9) { pulseOp = 0.9; dir = -1; }
          if (map && map.getLayer(layerId)) {
            map.setPaintProperty(layerId, 'fill-opacity', pulseOp);
          }
        }, 500);
        pulseIntervalsRef.current.push(pulseInterval);
      }

      map.on('click', layerId, () => {
        const riskLabel = isHigh ? 'HIGH' : 'MODERATE';
        const lastDate = zone.last_incident
          ? new Date(zone.last_incident).toLocaleDateString()
          : 'Unknown';

        const container = document.createElement('div');
        container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222';

        const heading = document.createElement('div');
        heading.style.cssText = `font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}`;
        heading.textContent = `${riskLabel} Risk Zone`;
        container.appendChild(heading);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%;font-size:11px;border-collapse:collapse';

        const addRow = (lbl: string, val: string, valColor?: string) => {
          const tr = document.createElement('tr');
          const tdLabel = document.createElement('td');
          tdLabel.style.cssText = 'color:#888888;padding:1px 6px 1px 0';
          tdLabel.textContent = lbl;
          const tdVal = document.createElement('td');
          tdVal.style.cssText = `color:${valColor || '#e0e0e0'}`;
          tdVal.textContent = val;
          tr.appendChild(tdLabel);
          tr.appendChild(tdVal);
          table.appendChild(tr);
        };

        addRow('Weapons', String(zone.weapons_count), '#ef4444');
        addRow('DV Incidents', String(zone.dv_count), '#f59e0b');
        addRow('Injuries', String(zone.injuries_count), '#fb923c');
        addRow('Total Flagged', String(zone.total_flagged));
        addRow('Last Incident', lastDate);

        container.appendChild(table);

        popupRef.current?.remove();
        popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', offset: 15 })
          .setLngLat([zone.longitude, zone.latitude])
          .setDOMContent(container)
          .addTo(map);
      });
    });

    return () => {
      removeZoneLayers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled, zones]);

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(() => {
    return () => {
      removeZoneLayers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { zones, loading, refresh, days, setDays };
}
