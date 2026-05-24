// ============================================================
// RMPG Flex — useMapCorridor Hook
// Patrol corridor and route safety analysis: risk-colored
// polylines, pursuit projections, escape routes, and
// traffic-aware annotations.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
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
  const R = 3958.8; // Earth radius mi
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

// ─── Source/layer helpers ───────────────────────────────────

function removeSourceAndLayer(map: mapboxgl.Map, layerId: string, sourceId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch { /* ignore */ }
}

const SEGMENTS_SOURCE = 'corridor-segments-source';
const SEGMENTS_LAYER = 'corridor-segments-layer';
const PURSUIT_SOURCE = 'corridor-pursuit-source';
const PURSUIT_LAYER = 'corridor-pursuit-layer';
const ESCAPE_SOURCE = 'corridor-escape-source';
const ESCAPE_LAYER = 'corridor-escape-layer';

// ─── Hook ───────────────────────────────────────────────────

export function useMapCorridor(
  map: mapboxgl.Map | null,
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
  const incidentMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const trafficLabelsRef = useRef<mapboxgl.Marker[]>([]);

  // ── Clear corridor overlays ─────────────────────────────────

  const clearCorridorOverlays = useCallback(() => {
    if (map) {
      removeSourceAndLayer(map, SEGMENTS_LAYER, SEGMENTS_SOURCE);
    }
    incidentMarkersRef.current.forEach((m) => m.remove());
    incidentMarkersRef.current = [];
    trafficLabelsRef.current.forEach((m) => m.remove());
    trafficLabelsRef.current = [];
  }, [map]);

  // ── Clear pursuit projection ────────────────────────────────

  const clearPursuit = useCallback(() => {
    if (map) {
      removeSourceAndLayer(map, PURSUIT_LAYER, PURSUIT_SOURCE);
    }
    setPursuitProjection(null);
  }, [map]);

  // ── Clear escape routes ─────────────────────────────────────

  const clearEscapeRoutes = useCallback(() => {
    if (map) {
      removeSourceAndLayer(map, ESCAPE_LAYER, ESCAPE_SOURCE);
    }
  }, [map]);

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
      if (!enabled || !map) return;
      setLoading(true);
      try {
        const data = await apiFetch<CorridorData>(
          `/map/safety/corridor-analysis?lat1=${lat1}&lng1=${lng1}&lat2=${lat2}&lng2=${lng2}`,
        );
        if (!data?.segments) return;

        clearCorridorOverlays();
        setCorridorData(data);

        // Render risk-colored polyline segments via GeoJSON source
        const segmentFeatures: GeoJSON.Feature[] = data.segments.map((seg) => ({
          type: 'Feature',
          properties: { risk_score: seg.risk_score },
          geometry: {
            type: 'LineString',
            coordinates: [
              [seg.start.lng, seg.start.lat],
              [seg.end.lng, seg.end.lat],
            ],
          },
        }));

        if (segmentFeatures.length > 0) {
          map.addSource(SEGMENTS_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: segmentFeatures },
          });
          map.addLayer({
            id: SEGMENTS_LAYER,
            type: 'line',
            source: SEGMENTS_SOURCE,
            paint: {
              'line-width': 4,
              'line-opacity': 0.85,
              'line-color': [
                'case',
                ['<=', ['get', 'risk_score'], 3], '#22c55e',
                ['<=', ['get', 'risk_score'], 6], '#f59e0b',
                '#ef4444',
              ],
            },
          });
        }

        // Incident markers and traffic annotations
        data.segments.forEach((seg) => {
          seg.incidents.forEach((inc) => {
            const el = document.createElement('div');
            el.style.cssText = `
              width: 6px; height: 6px; border-radius: 50%;
              background: #ef4444; border: 1px solid #7f1d1d;
              cursor: pointer;
            `;
            el.title = `${inc.type} — ${inc.date}`;
            el.style.zIndex = '11';
            const marker = new mapboxgl.Marker({ element: el })
              .setLngLat([inc.lng, inc.lat])
              .addTo(map);
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

            const img = document.createElement('img');
            img.src = canvasDataUrl;
            img.style.cssText = 'width:100px;height:20px;pointer-events:none;';
            img.style.zIndex = '12';
            const label = new mapboxgl.Marker({ element: img })
              .setLngLat([midLng, midLat])
              .addTo(map);
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
      if (!map) return;

      clearPursuit();
      setPursuitProjection({ lat, lng, heading });

      const leftEdge = destinationPoint(lat, lng, heading - 30, 2);
      const rightEdge = destinationPoint(lat, lng, heading + 30, 2);
      const tip = destinationPoint(lat, lng, heading, 2);

      map.addSource(PURSUIT_SOURCE, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [lng, lat],
              [leftEdge.lng, leftEdge.lat],
              [tip.lng, tip.lat],
              [rightEdge.lng, rightEdge.lat],
              [lng, lat],
            ]],
          },
        },
      });
      map.addLayer({
        id: PURSUIT_LAYER,
        type: 'fill',
        source: PURSUIT_SOURCE,
        paint: {
          'fill-color': '#f59e0b',
          'fill-opacity': 0.1,
          'fill-outline-color': '#f59e0b',
        },
      });
    },
    [map, clearPursuit],
  );

  // ── Escape routes (4 cardinal lines) ────────────────────────

  const showEscapeRoutes = useCallback(
    (lat: number, lng: number) => {
      if (!map) return;

      clearEscapeRoutes();

      const DISTANCE_MI = 0.93;
      const directions = [
        { heading: 0, label: 'N' },
        { heading: 90, label: 'E' },
        { heading: 180, label: 'S' },
        { heading: 270, label: 'W' },
      ];

      const features: GeoJSON.Feature[] = directions.map((dir) => {
        const endpoint = destinationPoint(lat, lng, dir.heading, DISTANCE_MI);
        return {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [lng, lat],
              [endpoint.lng, endpoint.lat],
            ],
          },
        };
      });

      map.addSource(ESCAPE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });
      map.addLayer({
        id: ESCAPE_LAYER,
        type: 'line',
        source: ESCAPE_SOURCE,
        paint: {
          'line-color': '#a855f7',
          'line-width': 2,
          'line-opacity': 0.7,
        },
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
      if (map) {
        removeSourceAndLayer(map, SEGMENTS_LAYER, SEGMENTS_SOURCE);
        removeSourceAndLayer(map, PURSUIT_LAYER, PURSUIT_SOURCE);
        removeSourceAndLayer(map, ESCAPE_LAYER, ESCAPE_SOURCE);
      }
      incidentMarkersRef.current.forEach((m) => m.remove());
      incidentMarkersRef.current = [];
      trafficLabelsRef.current.forEach((m) => m.remove());
      trafficLabelsRef.current = [];
    };
  }, [map]);

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
