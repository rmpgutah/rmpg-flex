// ============================================================
// RMPG Flex — useMapThreatAssessment Hook
// Threat assessment overlays: threat score circle, approach
// routes, hazard markers, armed-history icons, DV-repeat markers.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

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

// ─── Color mapping ──────────────────────────────────────────

const THREAT_COLORS: Record<string, string> = {
  low: '#22c55e',
  moderate: '#f59e0b',
  high: '#ef4444',
  critical: '#7f1d1d',
};

// ─── Circle polygon approximation ───────────────────────────

function circleCoords(center: [number, number], radiusM: number, segments = 64): [number, number][] {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center[1] * Math.PI / 180);
  const dLat = radiusM / metersPerDegLat;
  const dLng = radiusM / metersPerDegLng;
  const coords: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    coords.push([center[0] + dLng * Math.cos(angle), center[1] + dLat * Math.sin(angle)]);
  }
  return coords;
}

// ─── Source/layer helpers ───────────────────────────────────

function removeSourceAndLayer(map: mapboxgl.Map, layerId: string, sourceId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch { /* ignore */ }
}

const THREAT_CIRCLE_SOURCE = 'threat-circle-source';
const THREAT_CIRCLE_LAYER = 'threat-circle-layer';
const APPROACH_SOURCE = 'threat-approach-source';
const APPROACH_LAYER = 'threat-approach-layer';

// ─── Hook ───────────────────────────────────────────────────

export function useMapThreatAssessment(
  map: mapboxgl.Map | null,
  enabled: boolean,
  _units?: any[],
): UseMapThreatAssessmentReturn {
  const [currentAssessment, setCurrentAssessment] = useState<ThreatAssessment | null>(null);
  const [approachRoutes, setApproachRoutes] = useState<ApproachRoute[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Refs for map overlays
  const hazardMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const armedMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const dvMarkersRef = useRef<mapboxgl.Marker[]>([]);

  // ── Clear all map overlays ────────────────────────────────

  const clearOverlays = useCallback(() => {
    if (map) {
      removeSourceAndLayer(map, THREAT_CIRCLE_LAYER, THREAT_CIRCLE_SOURCE);
      removeSourceAndLayer(map, APPROACH_LAYER, APPROACH_SOURCE);
    }
    hazardMarkersRef.current.forEach((m) => m.remove());
    hazardMarkersRef.current = [];
    armedMarkersRef.current.forEach((m) => m.remove());
    armedMarkersRef.current = [];
    dvMarkersRef.current.forEach((m) => m.remove());
    dvMarkersRef.current = [];
  }, [map]);

  // ── Render assessment overlays ────────────────────────────

  const renderAssessment = useCallback(
    (assessment: ThreatAssessment) => {
      if (!map) return;

      clearOverlays();

      const color = THREAT_COLORS[assessment.level] || THREAT_COLORS.moderate;

      // Threat score circle (polygon approximation)
      const circlePoly = circleCoords([assessment.lng, assessment.lat], 200);
      map.addSource(THREAT_CIRCLE_SOURCE, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [circlePoly],
          },
        },
      });
      map.addLayer({
        id: THREAT_CIRCLE_LAYER,
        type: 'fill',
        source: THREAT_CIRCLE_SOURCE,
        paint: {
          'fill-color': color,
          'fill-opacity': 0.18,
          'fill-outline-color': color,
        },
      });

      // Hazard markers
      assessment.hazards.forEach((h) => {
        const el = document.createElement('div');
        el.title = `Hazard: ${h.type} — ${h.description}`;
        el.style.cssText = `
          width: 20px; height: 20px; display: flex; align-items: center;
          justify-content: center; cursor: pointer;
          font-size: 16px; color: #f59e0e;
        `;
        el.textContent = '\u25C0'; // left-pointing triangle as arrow proxy
        el.style.zIndex = '12';
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([h.lng, h.lat])
          .addTo(map);
        hazardMarkersRef.current.push(marker);
      });

      // Armed-history markers (simple gun-shape via SVG)
      assessment.armed_history.forEach((a) => {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '12');
        svg.setAttribute('viewBox', '0 0 20 12');
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', 'M2 4h4v2H2V4zm6 0h12v2H8V4zM2 8h18v2H2V8z');
        path.setAttribute('fill', '#ef4444');
        path.setAttribute('stroke', '#7f1d1d');
        path.setAttribute('stroke-width', '1');
        svg.appendChild(path);

        const el = document.createElement('div');
        el.title = `Armed History: ${a.incident_count} weapon call(s), last ${a.last_date}`;
        el.style.cssText = 'cursor:pointer;display:flex;align-items:center;justify-content:center;';
        el.style.zIndex = '13';
        el.appendChild(svg);

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([a.lng, a.lat])
          .addTo(map);
        armedMarkersRef.current.push(marker);
      });

      // DV-repeat location markers
      assessment.dv_repeat_locations.forEach((dv) => {
        const el = document.createElement('div');
        el.title = `DV Repeat: ${dv.call_count} calls — ${dv.address}`;
        el.style.cssText = `
          width: 14px; height: 14px; border-radius: 50%;
          background: #a855f7; border: 2px solid #581c87;
          cursor: pointer;
        `;
        el.style.zIndex = '11';
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([dv.lng, dv.lat])
          .addTo(map);
        dvMarkersRef.current.push(marker);
      });
    },
    [map, clearOverlays],
  );

  // ── Render approach routes ────────────────────────────────

  const renderApproachRoutes = useCallback(
    (routes: ApproachRoute[]) => {
      if (!map) return;

      // Clear previous approach lines only
      removeSourceAndLayer(map, APPROACH_LAYER, APPROACH_SOURCE);

      const routeColors: Record<string, string> = {
        low: '#22c55e',
        moderate: '#f59e0b',
        high: '#ef4444',
      };

      const features: GeoJSON.Feature[] = routes.map((route) => {
        const color = routeColors[route.risk_level] || '#f59e0b';
        const coords: [number, number][] = route.path.map((p) => [p.lng, p.lat]);
        return {
          type: 'Feature',
          properties: { color },
          geometry: { type: 'LineString', coordinates: coords },
        };
      });

      if (features.length === 0) return;

      map.addSource(APPROACH_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });
      map.addLayer({
        id: APPROACH_LAYER,
        type: 'line',
        source: APPROACH_SOURCE,
        paint: {
          'line-width': 3,
          'line-opacity': 0.8,
          'line-color': ['get', 'color'],
        },
      });
    },
    [map],
  );

  // ── assessLocation ────────────────────────────────────────

  const abortControllerRef = useRef<AbortController | null>(null);

  const assessLocation = useCallback(
    async (lat: number, lng: number) => {
      if (!enabled) return;
      // Abort any in-flight assessment request
      if (abortControllerRef.current) abortControllerRef.current.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      try {
        const data = await apiFetch<ThreatAssessment>(
          `/map/safety/threat-assessment/${lat}/${lng}`,
          { signal: controller.signal },
        );
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
    },
    [enabled, renderAssessment],
  );

  // ── getApproachRoutes ─────────────────────────────────────

  const getApproachRoutes = useCallback(
    async (lat: number, lng: number) => {
      if (!enabled) return;
      setLoading(true);
      try {
        const data = await apiFetch<ApproachRoute[]>(
          `/map/safety/approach-routes/${lat}/${lng}`,
        );
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
    },
    [enabled, renderApproachRoutes],
  );

  // ── clearAssessment ───────────────────────────────────────

  const clearAssessment = useCallback(() => {
    clearOverlays();
    setCurrentAssessment(null);
    setApproachRoutes(null);
  }, [clearOverlays]);

  // ── Cleanup on unmount or disabled ────────────────────────

  useEffect(() => {
    if (!enabled) {
      clearOverlays();
      setCurrentAssessment(null);
      setApproachRoutes(null);
    }
    return () => {
      clearOverlays();
    };
  }, [enabled, clearOverlays]);

  return {
    assessLocation,
    getApproachRoutes,
    clearAssessment,
    currentAssessment,
    approachRoutes,
    loading,
  };
}
