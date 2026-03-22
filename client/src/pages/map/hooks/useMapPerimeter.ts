// ============================================================
// RMPG Flex — useMapPerimeter Hook
// Perimeter visualization, coverage gap analysis, containment
// polygon drawing, sector overlays, and critical infrastructure.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

interface QuadrantCoverage {
  quadrant: 'NE' | 'NW' | 'SE' | 'SW';
  has_units: boolean;
  unit_count: number;
}

interface PerimeterData {
  lat: number;
  lng: number;
  quadrants: QuadrantCoverage[];
  total_units: number;
}

interface CoverageGap {
  lat: number;
  lng: number;
  width: number;
  height: number;
}

interface CoverageGapData {
  gaps: CoverageGap[];
  coverage_percent: number;
  suggested_staging: { lat: number; lng: number } | null;
}

interface UseMapPerimeterReturn {
  showPerimeter: (lat: number, lng: number) => Promise<void>;
  clearPerimeter: () => void;
  coverageGaps: CoverageGap[];
  coveragePercent: number;
  startContainment: () => void;
  endContainment: () => void;
  containmentPolygon: { lat: number; lng: number }[];
  showPerimeterRings: (lat: number, lng: number, innerM: number, outerM: number) => void;
  clearRings: () => void;
  stagingSuggestion: { lat: number; lng: number } | null;
  loading: boolean;
}

// ─── SLC critical infrastructure ────────────────────────────

const HIGH_VALUE_TARGETS = [
  { lat: 40.7608, lng: -111.891, name: 'Utah State Capitol' },
  { lat: 40.7718, lng: -111.8882, name: 'LDS Hospital' },
  { lat: 40.7587, lng: -111.8762, name: 'University of Utah Hospital' },
  { lat: 40.7496, lng: -111.8862, name: 'Salt Lake City Public Safety Bldg' },
  { lat: 40.7606, lng: -111.8939, name: 'Capitol Hill Elementary' },
  { lat: 40.7505, lng: -111.8916, name: 'SLC Federal Building' },
  { lat: 40.7686, lng: -111.8453, name: 'East High School' },
  { lat: 40.7341, lng: -111.9022, name: 'West High School' },
  { lat: 40.7621, lng: -111.8987, name: 'City Creek Center' },
  { lat: 40.7708, lng: -111.8920, name: 'Primary Children\'s Hospital' },
];

// ─── Quadrant colors ────────────────────────────────────────

const COVERED_COLOR = '#22c55e';
const GAP_COLOR = '#ef4444';

// ─── Hook ───────────────────────────────────────────────────

export function useMapPerimeter(
  map: google.maps.Map | null,
  enabled: boolean,
): UseMapPerimeterReturn {
  const [loading, setLoading] = useState(false);
  const [coverageGaps, setCoverageGaps] = useState<CoverageGap[]>([]);
  const [coveragePercent, setCoveragePercent] = useState(0);
  const [stagingSuggestion, setStagingSuggestion] = useState<{ lat: number; lng: number } | null>(null);
  const [containmentPolygon, setContainmentPolygon] = useState<{ lat: number; lng: number }[]>([]);

  // Map object refs
  const quadrantRectsRef = useRef<google.maps.Rectangle[]>([]);
  const gapRectsRef = useRef<google.maps.Rectangle[]>([]);
  const ringCirclesRef = useRef<google.maps.Circle[]>([]);
  const containmentPolyRef = useRef<google.maps.Polygon | null>(null);
  const containmentMarkersRef = useRef<google.maps.Marker[]>([]);
  const hvtMarkersRef = useRef<google.maps.Marker[]>([]);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const dblClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const isDrawingRef = useRef(false);
  const verticesRef = useRef<{ lat: number; lng: number }[]>([]);

  // ── Clear perimeter quadrants ───────────────────────────────

  const clearQuadrants = useCallback(() => {
    quadrantRectsRef.current.forEach((r) => r.setMap(null));
    quadrantRectsRef.current = [];
  }, []);

  // ── Clear gap rectangles ────────────────────────────────────

  const clearGapRects = useCallback(() => {
    gapRectsRef.current.forEach((r) => r.setMap(null));
    gapRectsRef.current = [];
  }, []);

  // ── Clear rings ─────────────────────────────────────────────

  const clearRings = useCallback(() => {
    ringCirclesRef.current.forEach((c) => c.setMap(null));
    ringCirclesRef.current = [];
  }, []);

  // ── Clear containment ───────────────────────────────────────

  const clearContainment = useCallback(() => {
    if (containmentPolyRef.current) {
      containmentPolyRef.current.setMap(null);
      containmentPolyRef.current = null;
    }
    containmentMarkersRef.current.forEach((m) => m.setMap(null));
    containmentMarkersRef.current = [];
    if (clickListenerRef.current) {
      google.maps.event.removeListener(clickListenerRef.current);
      clickListenerRef.current = null;
    }
    if (dblClickListenerRef.current) {
      google.maps.event.removeListener(dblClickListenerRef.current);
      dblClickListenerRef.current = null;
    }
    isDrawingRef.current = false;
    verticesRef.current = [];
    setContainmentPolygon([]);
  }, []);

  // ── Clear HVT markers ──────────────────────────────────────

  const clearHvtMarkers = useCallback(() => {
    hvtMarkersRef.current.forEach((m) => m.setMap(null));
    hvtMarkersRef.current = [];
  }, []);

  // ── Clear all ───────────────────────────────────────────────

  const clearPerimeter = useCallback(() => {
    clearQuadrants();
    clearGapRects();
    clearRings();
    clearContainment();
    clearHvtMarkers();
    setCoverageGaps([]);
    setCoveragePercent(0);
    setStagingSuggestion(null);
  }, [clearQuadrants, clearGapRects, clearRings, clearContainment, clearHvtMarkers]);

  // ── Render HVT markers ─────────────────────────────────────

  const renderHvtMarkers = useCallback(() => {
    if (!map || !window.google?.maps) return;

    clearHvtMarkers();

    HIGH_VALUE_TARGETS.forEach((target) => {
      const marker = new google.maps.Marker({
        position: { lat: target.lat, lng: target.lng },
        map,
        icon: {
          path: 'M12 2L4 7v5c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V7l-8-5z',
          scale: 1.0,
          fillColor: '#3b82f6',
          fillOpacity: 0.85,
          strokeColor: '#1e40af',
          strokeWeight: 1,
          anchor: new google.maps.Point(12, 22),
        },
        title: target.name,
        zIndex: 8,
      });
      hvtMarkersRef.current.push(marker);
    });
  }, [map, clearHvtMarkers]);

  // ── Show perimeter with quadrant coverage ───────────────────

  const showPerimeter = useCallback(
    async (lat: number, lng: number) => {
      if (!enabled || !map || !window.google?.maps) return;
      setLoading(true);
      try {
        const data = await apiFetch<PerimeterData>(
          `/map/safety/perimeter-check/${lat}/${lng}`,
        );
        if (!data?.quadrants) return;

        clearQuadrants();
        clearGapRects();

        // Quadrant size: ~0.005 degrees (~500m)
        const SIZE = 0.005;
        const offsets: Record<string, { latOff: number; lngOff: number }> = {
          NE: { latOff: 0, lngOff: 0 },
          NW: { latOff: 0, lngOff: -SIZE },
          SE: { latOff: -SIZE, lngOff: 0 },
          SW: { latOff: -SIZE, lngOff: -SIZE },
        };

        data.quadrants.forEach((q) => {
          const off = offsets[q.quadrant];
          if (!off) return;
          const color = q.has_units ? COVERED_COLOR : GAP_COLOR;
          const rect = new google.maps.Rectangle({
            bounds: {
              north: lat + off.latOff + SIZE,
              south: lat + off.latOff,
              east: lng + off.lngOff + SIZE,
              west: lng + off.lngOff,
            },
            fillColor: color,
            fillOpacity: 0.12,
            strokeColor: color,
            strokeWeight: 1,
            strokeOpacity: 0.5,
            map,
            clickable: false,
            zIndex: 6,
          });
          quadrantRectsRef.current.push(rect);
        });

        // Fetch coverage gaps
        const gapData = await apiFetch<CoverageGapData>('/map/safety/coverage-gaps');
        if (gapData) {
          setCoverageGaps(gapData.gaps || []);
          setCoveragePercent(gapData.coverage_percent || 0);
          setStagingSuggestion(gapData.suggested_staging || null);

          // Render gap rectangles
          (gapData.gaps || []).forEach((gap) => {
            const gapRect = new google.maps.Rectangle({
              bounds: {
                north: gap.lat + gap.height / 2,
                south: gap.lat - gap.height / 2,
                east: gap.lng + gap.width / 2,
                west: gap.lng - gap.width / 2,
              },
              fillColor: GAP_COLOR,
              fillOpacity: 0.08,
              strokeColor: GAP_COLOR,
              strokeWeight: 1,
              strokeOpacity: 0.3,
              map,
              clickable: false,
              zIndex: 5,
            });
            gapRectsRef.current.push(gapRect);
          });
        }

        // Render HVT markers
        renderHvtMarkers();
      } catch {
        // API error — silently fail
      } finally {
        setLoading(false);
      }
    },
    [enabled, map, clearQuadrants, clearGapRects, renderHvtMarkers],
  );

  // ── Containment perimeter draw tool ─────────────────────────

  const updateContainmentPoly = useCallback(() => {
    if (!map || !window.google?.maps) return;

    if (containmentPolyRef.current) {
      containmentPolyRef.current.setMap(null);
    }

    if (verticesRef.current.length < 2) return;

    containmentPolyRef.current = new google.maps.Polygon({
      paths: verticesRef.current,
      strokeColor: '#ef4444',
      strokeWeight: 2,
      strokeOpacity: 0.9,
      fillColor: '#ef4444',
      fillOpacity: 0.06,
      map,
      clickable: false,
      zIndex: 15,
    });
  }, [map]);

  const startContainment = useCallback(() => {
    if (!map || !window.google?.maps || isDrawingRef.current) return;

    // Clear previous containment
    clearContainment();
    isDrawingRef.current = true;
    verticesRef.current = [];

    // Click to add vertex
    clickListenerRef.current = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!isDrawingRef.current || !e.latLng) return;
      const point = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      verticesRef.current.push(point);

      // Add vertex marker
      const marker = new google.maps.Marker({
        position: point,
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 4,
          fillColor: '#ef4444',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 1,
        },
        zIndex: 16,
      });
      containmentMarkersRef.current.push(marker);

      updateContainmentPoly();
    });

    // Double-click to close polygon
    dblClickListenerRef.current = map.addListener('dblclick', () => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;

      if (clickListenerRef.current) {
        google.maps.event.removeListener(clickListenerRef.current);
        clickListenerRef.current = null;
      }
      if (dblClickListenerRef.current) {
        google.maps.event.removeListener(dblClickListenerRef.current);
        dblClickListenerRef.current = null;
      }

      setContainmentPolygon([...verticesRef.current]);
      updateContainmentPoly();
    });
  }, [map, clearContainment, updateContainmentPoly]);

  const endContainment = useCallback(() => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      if (clickListenerRef.current) {
        google.maps.event.removeListener(clickListenerRef.current);
        clickListenerRef.current = null;
      }
      if (dblClickListenerRef.current) {
        google.maps.event.removeListener(dblClickListenerRef.current);
        dblClickListenerRef.current = null;
      }
      setContainmentPolygon([...verticesRef.current]);
    }
  }, []);

  // ── Perimeter rings ─────────────────────────────────────────

  const showPerimeterRings = useCallback(
    (lat: number, lng: number, innerM: number, outerM: number) => {
      if (!map || !window.google?.maps) return;

      clearRings();
      const center = { lat, lng };

      // Inner ring
      const innerCircle = new google.maps.Circle({
        center,
        radius: innerM,
        fillColor: '#ef4444',
        fillOpacity: 0.08,
        strokeColor: '#ef4444',
        strokeWeight: 2,
        strokeOpacity: 0.7,
        map,
        clickable: false,
        zIndex: 7,
      });
      ringCirclesRef.current.push(innerCircle);

      // Outer ring
      const outerCircle = new google.maps.Circle({
        center,
        radius: outerM,
        fillColor: '#f59e0b',
        fillOpacity: 0.05,
        strokeColor: '#f59e0b',
        strokeWeight: 2,
        strokeOpacity: 0.5,
        map,
        clickable: false,
        zIndex: 6,
      });
      ringCirclesRef.current.push(outerCircle);
    },
    [map, clearRings],
  );

  // ── Cleanup on disable ──────────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      clearPerimeter();
    }
    return () => {
      clearPerimeter();
    };
  }, [enabled, clearPerimeter]);

  // ── Cleanup on unmount ──────────────────────────────────────

  useEffect(() => {
    return () => {
      quadrantRectsRef.current.forEach((r) => r.setMap(null));
      quadrantRectsRef.current = [];
      gapRectsRef.current.forEach((r) => r.setMap(null));
      gapRectsRef.current = [];
      ringCirclesRef.current.forEach((c) => c.setMap(null));
      ringCirclesRef.current = [];
      if (containmentPolyRef.current) {
        containmentPolyRef.current.setMap(null);
        containmentPolyRef.current = null;
      }
      containmentMarkersRef.current.forEach((m) => m.setMap(null));
      containmentMarkersRef.current = [];
      hvtMarkersRef.current.forEach((m) => m.setMap(null));
      hvtMarkersRef.current = [];
      if (clickListenerRef.current) {
        google.maps.event.removeListener(clickListenerRef.current);
        clickListenerRef.current = null;
      }
      if (dblClickListenerRef.current) {
        google.maps.event.removeListener(dblClickListenerRef.current);
        dblClickListenerRef.current = null;
      }
    };
  }, []);

  return {
    showPerimeter,
    clearPerimeter,
    coverageGaps,
    coveragePercent,
    startContainment,
    endContainment,
    containmentPolygon,
    showPerimeterRings,
    clearRings,
    stagingSuggestion,
    loading,
  };
}
