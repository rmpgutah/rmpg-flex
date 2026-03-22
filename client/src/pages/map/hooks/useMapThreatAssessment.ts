// ============================================================
// RMPG Flex — useMapThreatAssessment Hook
// Threat assessment overlays: threat score circle, approach
// routes, hazard markers, armed-history icons, DV-repeat markers.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
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

// ─── Hook ───────────────────────────────────────────────────

export function useMapThreatAssessment(
  map: google.maps.Map | null,
  enabled: boolean,
  _units?: any[],
): UseMapThreatAssessmentReturn {
  const [currentAssessment, setCurrentAssessment] = useState<ThreatAssessment | null>(null);
  const [approachRoutes, setApproachRoutes] = useState<ApproachRoute[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Refs for map overlays
  const threatCircleRef = useRef<google.maps.Circle | null>(null);
  const approachLinesRef = useRef<google.maps.Polyline[]>([]);
  const hazardMarkersRef = useRef<google.maps.Marker[]>([]);
  const armedMarkersRef = useRef<google.maps.Marker[]>([]);
  const dvMarkersRef = useRef<google.maps.Marker[]>([]);

  // ── Clear all map overlays ────────────────────────────────

  const clearOverlays = useCallback(() => {
    if (threatCircleRef.current) {
      threatCircleRef.current.setMap(null);
      threatCircleRef.current = null;
    }
    approachLinesRef.current.forEach((l) => l.setMap(null));
    approachLinesRef.current = [];
    hazardMarkersRef.current.forEach((m) => m.setMap(null));
    hazardMarkersRef.current = [];
    armedMarkersRef.current.forEach((m) => m.setMap(null));
    armedMarkersRef.current = [];
    dvMarkersRef.current.forEach((m) => m.setMap(null));
    dvMarkersRef.current = [];
  }, []);

  // ── Render assessment overlays ────────────────────────────

  const renderAssessment = useCallback(
    (assessment: ThreatAssessment) => {
      if (!map || !window.google?.maps) return;

      clearOverlays();

      const color = THREAT_COLORS[assessment.level] || THREAT_COLORS.moderate;

      // Threat score circle
      threatCircleRef.current = new google.maps.Circle({
        center: { lat: assessment.lat, lng: assessment.lng },
        radius: 200,
        fillColor: color,
        fillOpacity: 0.18,
        strokeColor: color,
        strokeWeight: 2,
        strokeOpacity: 0.7,
        map,
        clickable: false,
        zIndex: 10,
      });

      // Hazard markers
      assessment.hazards.forEach((h) => {
        const marker = new google.maps.Marker({
          position: { lat: h.lat, lng: h.lng },
          map,
          icon: {
            path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
            scale: 5,
            fillColor: '#f59e0b',
            fillOpacity: 0.9,
            strokeColor: '#92400e',
            strokeWeight: 1,
          },
          title: `Hazard: ${h.type} — ${h.description}`,
          zIndex: 12,
        });
        hazardMarkersRef.current.push(marker);
      });

      // Armed-history markers (gun icon shape)
      assessment.armed_history.forEach((a) => {
        const marker = new google.maps.Marker({
          position: { lat: a.lat, lng: a.lng },
          map,
          icon: {
            path: 'M2 4h4v2H2V4zm6 0h12v2H8V4zM2 8h18v2H2V8z',
            scale: 1.2,
            fillColor: '#ef4444',
            fillOpacity: 0.85,
            strokeColor: '#7f1d1d',
            strokeWeight: 1,
            anchor: new google.maps.Point(10, 5),
          },
          title: `Armed History: ${a.incident_count} weapon call(s), last ${a.last_date}`,
          zIndex: 13,
        });
        armedMarkersRef.current.push(marker);
      });

      // DV-repeat location markers
      assessment.dv_repeat_locations.forEach((dv) => {
        const marker = new google.maps.Marker({
          position: { lat: dv.lat, lng: dv.lng },
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: '#a855f7',
            fillOpacity: 0.8,
            strokeColor: '#581c87',
            strokeWeight: 2,
          },
          title: `DV Repeat: ${dv.call_count} calls — ${dv.address}`,
          zIndex: 11,
        });
        dvMarkersRef.current.push(marker);
      });
    },
    [map, clearOverlays],
  );

  // ── Render approach routes ────────────────────────────────

  const renderApproachRoutes = useCallback(
    (routes: ApproachRoute[]) => {
      if (!map || !window.google?.maps) return;

      // Clear previous approach lines only
      approachLinesRef.current.forEach((l) => l.setMap(null));
      approachLinesRef.current = [];

      const routeColors: Record<string, string> = {
        low: '#22c55e',
        moderate: '#f59e0b',
        high: '#ef4444',
      };

      routes.forEach((route) => {
        const color = routeColors[route.risk_level] || '#f59e0b';
        const path = route.path.map((p) => ({ lat: p.lat, lng: p.lng }));

        const line = new google.maps.Polyline({
          path,
          strokeColor: color,
          strokeWeight: 3,
          strokeOpacity: 0.8,
          icons: [
            {
              icon: {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 3,
                fillColor: color,
                fillOpacity: 1,
                strokeWeight: 0,
              },
              offset: '50%',
              repeat: '80px',
            },
          ],
          map,
          clickable: false,
          zIndex: 9,
        });
        approachLinesRef.current.push(line);
      });
    },
    [map],
  );

  // ── assessLocation ────────────────────────────────────────

  const assessLocation = useCallback(
    async (lat: number, lng: number) => {
      if (!enabled) return;
      setLoading(true);
      try {
        const data = await apiFetch<ThreatAssessment>(
          `/map/safety/threat-assessment/${lat}/${lng}`,
        );
        if (data) {
          setCurrentAssessment(data);
          renderAssessment(data);
        }
      } catch {
        setCurrentAssessment(null);
      } finally {
        setLoading(false);
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
      } catch {
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
