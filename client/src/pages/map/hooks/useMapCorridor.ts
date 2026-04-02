// ============================================================
// RMPG Flex — useMapCorridor Hook
// Patrol corridor and route safety analysis: risk-colored
// polylines, pursuit projections, escape routes, and
// traffic-aware annotations.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

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

// ─── Risk color helpers ─────────────────────────────────────

function riskColor(score: number): string {
  if (!Number.isFinite(score)) return '#666666';
  if (score <= 3) return '#22c55e';
  if (score <= 6) return '#f59e0b';
  return '#ef4444';
}

// ─── Destination from heading/distance ──────────────────────

function destinationPoint(
  lat: number,
  lng: number,
  headingDeg: number,
  distanceKm: number,
): { lat: number; lng: number } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(headingDeg) || !Number.isFinite(distanceKm)) return { lat, lng };
  const R = 6371; // Earth radius km
  const d = distanceKm / R;
  const brng = (headingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lng2 * 180) / Math.PI,
  };
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapCorridor(
  map: google.maps.Map | null,
  enabled: boolean,
): UseMapCorridorReturn {
  const [loading, setLoading] = useState(false);
  const [corridorData, setCorridorData] = useState<CorridorData | null>(null);
  const [pursuitProjection, setPursuitProjection] = useState<{
    lat: number;
    lng: number;
    heading: number;
  } | null>(null);

  // Map object refs
  const segmentLinesRef = useRef<google.maps.Polyline[]>([]);
  const incidentMarkersRef = useRef<google.maps.Marker[]>([]);
  const trafficLabelsRef = useRef<google.maps.Marker[]>([]);
  const pursuitPolyRef = useRef<google.maps.Polygon | null>(null);
  const escapeRouteLinesRef = useRef<google.maps.Polyline[]>([]);

  // ── Clear corridor overlays ─────────────────────────────────

  const clearCorridorOverlays = useCallback(() => {
    segmentLinesRef.current.forEach((l) => l.setMap(null));
    segmentLinesRef.current = [];
    incidentMarkersRef.current.forEach((m) => m.setMap(null));
    incidentMarkersRef.current = [];
    trafficLabelsRef.current.forEach((m) => m.setMap(null));
    trafficLabelsRef.current = [];
  }, []);

  // ── Clear pursuit projection ────────────────────────────────

  const clearPursuit = useCallback(() => {
    if (pursuitPolyRef.current) {
      pursuitPolyRef.current.setMap(null);
      pursuitPolyRef.current = null;
    }
    setPursuitProjection(null);
  }, []);

  // ── Clear escape routes ─────────────────────────────────────

  const clearEscapeRoutes = useCallback(() => {
    escapeRouteLinesRef.current.forEach((l) => l.setMap(null));
    escapeRouteLinesRef.current = [];
  }, []);

  // ── Clear all ───────────────────────────────────────────────

  const clearCorridor = useCallback(() => {
    clearCorridorOverlays();
    clearPursuit();
    clearEscapeRoutes();
    setCorridorData(null);
  }, [clearCorridorOverlays, clearPursuit, clearEscapeRoutes]);

  // ── Analyze corridor ────────────────────────────────────────

  const analyzeCorridor = useCallback(
    async (lat1: number, lng1: number, lat2: number, lng2: number) => {
      if (!enabled || !map || !window.google?.maps) return;
      setLoading(true);
      try {
        const data = await apiFetch<CorridorData>(
          `/map/safety/corridor-analysis?lat1=${lat1}&lng1=${lng1}&lat2=${lat2}&lng2=${lng2}`,
        );
        if (!data?.segments) return;

        clearCorridorOverlays();
        setCorridorData(data);

        // Render risk-colored polyline segments
        data.segments.forEach((seg) => {
          const color = riskColor(seg.risk_score);
          const line = new google.maps.Polyline({
            path: [seg.start, seg.end],
            strokeColor: color,
            strokeWeight: 4,
            strokeOpacity: 0.85,
            map,
            clickable: false,
            zIndex: 10,
          });
          segmentLinesRef.current.push(line);

          // Incident markers along the corridor
          seg.incidents.forEach((inc) => {
            const marker = new google.maps.Marker({
              position: { lat: inc.lat, lng: inc.lng },
              map,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 3,
                fillColor: '#ef4444',
                fillOpacity: 0.8,
                strokeColor: '#7f1d1d',
                strokeWeight: 1,
              },
              title: `${inc.type} — ${inc.date}`,
              zIndex: 11,
            });
            incidentMarkersRef.current.push(marker);
          });

          // Traffic annotations
          if (seg.traffic_label) {
            const midLat = (seg.start.lat + seg.end.lat) / 2;
            const midLng = (seg.start.lng + seg.end.lng) / 2;

            const canvas = document.createElement('canvas');
            canvas.width = 100;
            canvas.height = 20;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = seg.traffic_label === 'Heavy Traffic' ? '#f59e0b' : '#22c55e';
              ctx.font = '11px sans-serif';
              ctx.fillText(seg.traffic_label, 2, 14);
            }

            let canvasDataUrl: string;
            try {
              canvasDataUrl = canvas.toDataURL();
            } catch (err) {
              console.warn('[useMapCorridor] Canvas toDataURL failed:', err);
              return;
            }

            const label = new google.maps.Marker({
              position: { lat: midLat, lng: midLng },
              map,
              icon: {
                url: canvasDataUrl,
                scaledSize: new google.maps.Size(100, 20),
                anchor: new google.maps.Point(50, 10),
              },
              clickable: false,
              zIndex: 12,
            });
            trafficLabelsRef.current.push(label);
          }
        });
      } catch (err) {
        console.warn('[useMapCorridor] Corridor analysis failed:', err);
        setCorridorData(null);
      } finally {
        setLoading(false);
      }
    },
    [enabled, map, clearCorridorOverlays],
  );

  // ── Pursuit corridor projection (2km cone) ─────────────────

  const showPursuitProjection = useCallback(
    (lat: number, lng: number, heading: number) => {
      if (!map || !window.google?.maps) return;

      clearPursuit();
      setPursuitProjection({ lat, lng, heading });

      const origin = { lat, lng };
      const leftEdge = destinationPoint(lat, lng, heading - 30, 2);
      const rightEdge = destinationPoint(lat, lng, heading + 30, 2);
      const tip = destinationPoint(lat, lng, heading, 2);

      pursuitPolyRef.current = new google.maps.Polygon({
        paths: [origin, leftEdge, tip, rightEdge],
        strokeColor: '#f59e0b',
        strokeWeight: 2,
        strokeOpacity: 0.8,
        fillColor: '#f59e0b',
        fillOpacity: 0.1,
        map,
        clickable: false,
        zIndex: 14,
      });
    },
    [map, clearPursuit],
  );

  // ── Escape routes (4 cardinal lines) ────────────────────────

  const showEscapeRoutes = useCallback(
    (lat: number, lng: number) => {
      if (!map || !window.google?.maps) return;

      clearEscapeRoutes();

      const DISTANCE_KM = 1.5;
      const directions = [
        { heading: 0, label: 'N' },
        { heading: 90, label: 'E' },
        { heading: 180, label: 'S' },
        { heading: 270, label: 'W' },
      ];

      directions.forEach((dir) => {
        const endpoint = destinationPoint(lat, lng, dir.heading, DISTANCE_KM);
        const line = new google.maps.Polyline({
          path: [{ lat, lng }, endpoint],
          strokeColor: '#a855f7',
          strokeWeight: 2,
          strokeOpacity: 0.7,
          icons: [
            {
              icon: {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 3,
                fillColor: '#a855f7',
                fillOpacity: 1,
                strokeWeight: 0,
              },
              offset: '100%',
            },
          ],
          map,
          clickable: false,
          zIndex: 13,
        });
        escapeRouteLinesRef.current.push(line);
      });
    },
    [map, clearEscapeRoutes],
  );

  // ── Cleanup on disable ──────────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      clearCorridor();
    }
    return () => {
      clearCorridor();
    };
  }, [enabled, clearCorridor]);

  // ── Cleanup on unmount ──────────────────────────────────────

  useEffect(() => {
    return () => {
      segmentLinesRef.current.forEach((l) => l.setMap(null));
      segmentLinesRef.current = [];
      incidentMarkersRef.current.forEach((m) => m.setMap(null));
      incidentMarkersRef.current = [];
      trafficLabelsRef.current.forEach((m) => m.setMap(null));
      trafficLabelsRef.current = [];
      if (pursuitPolyRef.current) {
        pursuitPolyRef.current.setMap(null);
        pursuitPolyRef.current = null;
      }
      escapeRouteLinesRef.current.forEach((l) => l.setMap(null));
      escapeRouteLinesRef.current = [];
    };
  }, []);

  return {
    analyzeCorridor,
    clearCorridor,
    corridorData,
    pursuitProjection,
    showPursuitProjection,
    clearPursuit,
    showEscapeRoutes,
    clearEscapeRoutes,
    loading,
  };
}
