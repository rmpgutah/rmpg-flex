import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

export interface HazardLocation {
  lat: number;
  lng: number;
  type: string;
  description: string;
}

export interface ArmedHistoryLocation {
  lat: number;
  lng: number;
  incident_count: number;
  last_date: string;
}

export interface DVRepeatLocation {
  lat: number;
  lng: number;
  call_count: number;
  address: string;
}

export interface ThreatAssessment {
  lat: number;
  lng: number;
  score: number;
  level: 'low' | 'moderate' | 'high' | 'critical';
  factors: string[];
  hazards: HazardLocation[];
  armed_history: ArmedHistoryLocation[];
  dv_repeat_locations: DVRepeatLocation[];
  recent_incidents: number;
  officer_safety_notes: string[];
}

export interface ApproachRoute {
  direction: string;
  heading: number;
  path: { lat: number; lng: number }[];
  risk_level: 'low' | 'moderate' | 'high';
  notes: string;
}

interface UseMapThreatAssessmentReturn {
  assessLocation: (lat: number, lng: number) => Promise<void>;
  getApproachRoutes: (lat: number, lng: number) => Promise<void>;
  clearAssessment: () => void;
  currentAssessment: ThreatAssessment | null;
  approachRoutes: ApproachRoute[] | null;
  loading: boolean;
}

const THREAT_COLORS: Record<string, string> = {
  low: '#22c55e',
  moderate: '#f59e0b',
  high: '#ef4444',
  critical: '#7f1d1d',
};

export function useMapThreatAssessment(
  map: mapboxgl.Map | null,
  enabled: boolean,
  _units?: any[],
): UseMapThreatAssessmentReturn {
  const [currentAssessment, setCurrentAssessment] = useState<ThreatAssessment | null>(null);
  const [approachRoutes, setApproachRoutes] = useState<ApproachRoute[] | null>(null);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const threatSourceId = 'threat-circle';
  const hazardSourceId = 'threat-hazards';
  const armedSourceId = 'threat-armed';
  const dvSourceId = 'threat-dv';
  const approachSourceId = 'threat-approach';

  const clearOverlays = useCallback(() => {
    if (!map) return;
    [threatSourceId, hazardSourceId, armedSourceId, dvSourceId, approachSourceId].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    });
  }, [map]);

  const renderAssessment = useCallback((assessment: ThreatAssessment) => {
    if (!map) return;
    clearOverlays();

    if (!popupRef.current) popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });

    const color = THREAT_COLORS[assessment.level] || THREAT_COLORS.moderate;

    map.addSource(threatSourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [assessment.lng, assessment.lat] as [number, number] }, properties: { color, score: assessment.score, level: assessment.level, factors: assessment.factors.join(', ') } }] },
    });
    map.addLayer({
      id: threatSourceId,
      type: 'circle',
      source: threatSourceId,
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': 200,
        'circle-opacity': 0.18,
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 0.7,
      },
    });

    map.on('click', threatSourceId, (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;
      const p = feature.properties;
      const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid ${p.color}40"><div style="font-weight:bold;font-size:12px;color:${p.color};margin-bottom:4px">Threat Assessment</div><div style="font-size:10px;color:#9ca3af">Score: ${p.score} | Level: ${p.level}</div><div style="font-size:9px;color:#6b7280;margin-top:4px">${p.factors}</div></div>`;
      if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });

    if (assessment.hazards.length > 0) {
      const hazardFeatures = assessment.hazards.map(h => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [h.lng, h.lat] as [number, number] },
        properties: { type: h.type, description: h.description },
      }));
      map.addSource(hazardSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: hazardFeatures } });
      map.addLayer({
        id: hazardSourceId,
        type: 'circle',
        source: hazardSourceId,
        paint: { 'circle-color': '#f59e0b', 'circle-radius': 5, 'circle-stroke-color': '#92400e', 'circle-stroke-width': 1 },
      });
      map.on('click', hazardSourceId, (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:8px 10px;border-radius:4px;border:1px solid #f59e0b40"><div style="font-weight:bold;color:#f59e0b">Hazard: ${feature.properties.type}</div><div style="font-size:9px;color:#9ca3af;margin-top:2px">${feature.properties.description}</div></div>`;
        if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
    }

    if (assessment.armed_history.length > 0) {
      const armedFeatures = assessment.armed_history.map(a => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] as [number, number] },
        properties: { count: a.incident_count, last_date: a.last_date },
      }));
      map.addSource(armedSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: armedFeatures } });
      map.addLayer({
        id: armedSourceId,
        type: 'circle',
        source: armedSourceId,
        paint: { 'circle-color': '#ef4444', 'circle-radius': 7, 'circle-stroke-color': '#7f1d1d', 'circle-stroke-width': 1 },
      });
      map.on('click', armedSourceId, (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:8px 10px;border-radius:4px;border:1px solid #ef444440"><div style="font-weight:bold;color:#ef4444">Armed History</div><div style="font-size:9px;color:#9ca3af;margin-top:2px">${feature.properties.count} weapon call(s), last ${feature.properties.last_date}</div></div>`;
        if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
    }

    if (assessment.dv_repeat_locations.length > 0) {
      const dvFeatures = assessment.dv_repeat_locations.map(dv => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [dv.lng, dv.lat] as [number, number] },
        properties: { count: dv.call_count, address: dv.address },
      }));
      map.addSource(dvSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: dvFeatures } });
      map.addLayer({
        id: dvSourceId,
        type: 'circle',
        source: dvSourceId,
        paint: { 'circle-color': '#a855f7', 'circle-radius': 7, 'circle-stroke-color': '#581c87', 'circle-stroke-width': 2 },
      });
      map.on('click', dvSourceId, (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:8px 10px;border-radius:4px;border:1px solid #a855f740"><div style="font-weight:bold;color:#a855f7">DV Repeat</div><div style="font-size:9px;color:#9ca3af;margin-top:2px">${feature.properties.count} calls — ${feature.properties.address}</div></div>`;
        if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
    }
  }, [map, clearOverlays]);

  const renderApproachRoutes = useCallback((routes: ApproachRoute[]) => {
    if (!map) return;
    if (map.getLayer(approachSourceId)) map.removeLayer(approachSourceId);
    if (map.getSource(approachSourceId)) map.removeSource(approachSourceId);

    const routeColors: Record<string, string> = { low: '#22c55e', moderate: '#f59e0b', high: '#ef4444' };

    const features = routes.map(route => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: route.path.map(p => [p.lng, p.lat] as [number, number]) },
      properties: { color: routeColors[route.risk_level] || '#f59e0b', direction: route.direction, notes: route.notes },
    }));

    map.addSource(approachSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: approachSourceId,
      type: 'line',
      source: approachSourceId,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 3,
        'line-opacity': 0.8,
      },
    });
  }, [map]);

  const abortControllerRef = useRef<AbortController | null>(null);

  const assessLocation = useCallback(async (lat: number, lng: number) => {
    if (!enabled) return;
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    try {
      const data = await apiFetch<ThreatAssessment>(`/map/safety/threat-assessment/${lat}/${lng}`, { signal: controller.signal });
      if (data && !controller.signal.aborted) {
        setCurrentAssessment(data);
        renderAssessment(data);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.warn('[useMapThreatAssessment] Assessment fetch failed:', err);
        setCurrentAssessment(null);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [enabled, renderAssessment]);

  const getApproachRoutes = useCallback(async (lat: number, lng: number) => {
    if (!enabled) return;
    setLoading(true);
    try {
      const data = await apiFetch<ApproachRoute[]>(`/map/safety/approach-routes/${lat}/${lng}`);
      if (data) {
        setApproachRoutes(data);
        renderApproachRoutes(data);
      }
    } catch (err) {
      console.warn('[useMapThreatAssessment] Approach routes fetch failed:', err);
      setApproachRoutes(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, renderApproachRoutes]);

  const clearAssessment = useCallback(() => {
    clearOverlays();
    setCurrentAssessment(null);
    setApproachRoutes(null);
  }, [clearOverlays]);

  useEffect(() => {
    if (!enabled) {
      clearOverlays();
      setCurrentAssessment(null);
      setApproachRoutes(null);
    }
    return () => { clearOverlays(); };
  }, [enabled, clearOverlays]);

  useEffect(() => {
    return () => {
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    };
  }, []);

  return { assessLocation, getApproachRoutes, clearAssessment, currentAssessment, approachRoutes, loading };
}
