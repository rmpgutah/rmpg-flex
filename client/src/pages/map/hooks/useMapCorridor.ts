import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { whenStyleReady } from '../utils/safeAddSource';

interface CorridorSegment {
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  risk_score: number;
  incidents: CorridorIncident[];
  traffic_label: string | null;
  ambush_notes: string[];
}

interface CorridorIncident {
  lat: number;
  lng: number;
  type: string;
  date: string;
}

interface CorridorData {
  total_risk_score: number;
  segments: CorridorSegment[];
  ambush_vulnerabilities: string[];
}

interface UseMapCorridorReturn {
  analyzeCorridor: (lat1: number, lng1: number, lat2: number, lng2: number) => Promise<void>;
  clearCorridor: () => void;
  corridorData: CorridorData | null;
  pursuitProjection: { lat: number; lng: number; heading: number } | null;
  showPursuitProjection: (lat: number, lng: number, heading: number) => void;
  clearPursuit: () => void;
  showEscapeRoutes: (lat: number, lng: number) => void;
  clearEscapeRoutes: () => void;
  loading: boolean;
}

function riskColor(score: number): string {
  if (!Number.isFinite(score)) return '#666666';
  if (score <= 3) return '#22c55e';
  if (score <= 6) return '#f59e0b';
  return '#ef4444';
}

function destinationPoint(lat: number, lng: number, headingDeg: number, distanceKm: number): { lat: number; lng: number } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(headingDeg) || !Number.isFinite(distanceKm)) return { lat, lng };
  const R = 3958.8;
  const d = distanceKm / R;
  const brng = (headingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

export function useMapCorridor(
  map: mapboxgl.Map | null,
  enabled: boolean,
): UseMapCorridorReturn {
  const [loading, setLoading] = useState(false);
  const [corridorData, setCorridorData] = useState<CorridorData | null>(null);
  const [pursuitProjection, setPursuitProjection] = useState<{ lat: number; lng: number; heading: number } | null>(null);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const segmentSourceId = 'corridor-segments';
  const incidentSourceId = 'corridor-incidents';
  const pursuitSourceId = 'corridor-pursuit';
  const escapeSourceId = 'corridor-escape';

  const clearSource = useCallback((id: string) => {
    if (!map) return;
    if (map.getLayer(`${id}-outline`)) map.removeLayer(`${id}-outline`);
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }, [map]);

  const clearCorridor = useCallback(() => {
    [segmentSourceId, incidentSourceId, pursuitSourceId, escapeSourceId].forEach(clearSource);
    setCorridorData(null);
    setPursuitProjection(null);
  }, [clearSource]);

  const clearPursuit = useCallback(() => { clearSource(pursuitSourceId); setPursuitProjection(null); }, [clearSource]);
  const clearEscapeRoutes = useCallback(() => { clearSource(escapeSourceId); }, [clearSource]);

  const analyzeCorridor = useCallback(async (lat1: number, lng1: number, lat2: number, lng2: number) => {
    if (!enabled || !map) return;
    setLoading(true);
    try {
      const data = await apiFetch<CorridorData>(`/map/safety/corridor-analysis?lat1=${lat1}&lng1=${lng1}&lat2=${lat2}&lng2=${lng2}`);
      if (!data?.segments) return;

      clearSource(segmentSourceId);
      clearSource(incidentSourceId);
      setCorridorData(data);

      if (!popupRef.current) popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });

      const segmentFeatures: any[] = [];
      const incidentFeatures: any[] = [];

      data.segments.forEach((seg) => {
        const color = riskColor(seg.risk_score);
        segmentFeatures.push({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: [[seg.start.lng, seg.start.lat], [seg.end.lng, seg.end.lat]] as [number, number][] },
          properties: { color, risk_score: seg.risk_score, traffic_label: seg.traffic_label },
        });

        seg.incidents.forEach((inc) => {
          if (!inc || typeof inc.lng !== 'number' || typeof inc.lat !== 'number') return;
          incidentFeatures.push({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [inc.lng, inc.lat] as [number, number] },
            properties: { type: inc.type, date: inc.date },
          });
        });
      });

      if (segmentFeatures.length > 0) {
        whenStyleReady(map, () => {
          map.addSource(segmentSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: segmentFeatures } });
          map.addLayer({
            id: segmentSourceId,
            type: 'line',
            source: segmentSourceId,
            paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.85 },
          });

          map.on('click', segmentSourceId, (e) => {
            const feature = e.features?.[0];
            if (!feature || !feature.properties) return;
            const p = feature.properties;
            const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:8px 10px;border-radius:4px;border:1px solid ${p.color}40"><div style="font-weight:bold;color:${p.color}">Risk Score: ${p.risk_score}</div>${p.traffic_label ? `<div style="font-size:9px;color:#9ca3af;margin-top:2px">${p.traffic_label}</div>` : ''}</div>`;
            if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
          });
        });
      }

      if (incidentFeatures.length > 0) {
        whenStyleReady(map, () => {
          map.addSource(incidentSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: incidentFeatures } });
          map.addLayer({
            id: incidentSourceId,
            type: 'circle',
            source: incidentSourceId,
            paint: { 'circle-color': '#ef4444', 'circle-radius': 3, 'circle-stroke-color': '#7f1d1d', 'circle-stroke-width': 1 },
          });

          map.on('click', incidentSourceId, (e) => {
            const feature = e.features?.[0];
            if (!feature || !feature.properties) return;
            const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:8px 10px;border-radius:4px;border:1px solid #ef444440"><div style="font-weight:bold;color:#ef4444">${feature.properties.type}</div><div style="font-size:9px;color:#9ca3af;margin-top:2px">${feature.properties.date}</div></div>`;
            if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
          });
        });
      }
    } catch (err) {
      console.warn('[useMapCorridor] Corridor analysis failed:', err);
      setCorridorData(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, map, clearSource]);

  const showPursuitProjection = useCallback((lat: number, lng: number, heading: number) => {
    if (!map) return;
    clearSource(pursuitSourceId);
    setPursuitProjection({ lat, lng, heading });

    const leftEdge = destinationPoint(lat, lng, heading - 30, 2);
    const rightEdge = destinationPoint(lat, lng, heading + 30, 2);
    const tip = destinationPoint(lat, lng, heading, 2);

    const feature = {
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [[[lng, lat], [leftEdge.lng, leftEdge.lat], [tip.lng, tip.lat], [rightEdge.lng, rightEdge.lat], [lng, lat]]] },
      properties: {},
    };

    whenStyleReady(map, () => {
      map.addSource(pursuitSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [feature] } });
      map.addLayer({
        id: pursuitSourceId,
        type: 'fill',
        source: pursuitSourceId,
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.1 },
      });
      map.addLayer({
        id: `${pursuitSourceId}-outline`,
        type: 'line',
        source: pursuitSourceId,
        paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-opacity': 0.8 },
      });
    });
  }, [map, clearSource]);

  const showEscapeRoutes = useCallback((lat: number, lng: number) => {
    if (!map) return;
    clearSource(escapeSourceId);

    const DISTANCE_MI = 0.93;
    const directions = [
      { heading: 0, label: 'N' },
      { heading: 90, label: 'E' },
      { heading: 180, label: 'S' },
      { heading: 270, label: 'W' },
    ];

    const features = directions.map(dir => {
      const endpoint = destinationPoint(lat, lng, dir.heading, DISTANCE_MI);
      return {
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: [[lng, lat], [endpoint.lng, endpoint.lat]] as [number, number][] },
        properties: { direction: dir.label },
      };
    });

    whenStyleReady(map, () => {
      map.addSource(escapeSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: escapeSourceId,
        type: 'line',
        source: escapeSourceId,
        paint: { 'line-color': '#a855f7', 'line-width': 2, 'line-opacity': 0.7 },
      });
    });
  }, [map, clearSource]);

  useEffect(() => {
    if (!enabled) clearCorridor();
    return () => { clearCorridor(); };
  }, [enabled, clearCorridor]);

  useEffect(() => {
    return () => {
      [segmentSourceId, incidentSourceId, pursuitSourceId, escapeSourceId].forEach(id => {
        if (map?.getLayer(`${id}-outline`)) map.removeLayer(`${id}-outline`);
        if (map?.getLayer(id)) map.removeLayer(id);
        if (map?.getSource(id)) map.removeSource(id);
      });
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    };
  }, [map]);

  return { analyzeCorridor, clearCorridor, corridorData, pursuitProjection, showPursuitProjection, clearPursuit, showEscapeRoutes, clearEscapeRoutes, loading };
}
