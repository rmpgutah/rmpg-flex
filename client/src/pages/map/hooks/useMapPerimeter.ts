import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

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

const COVERED_COLOR = '#22c55e';
const GAP_COLOR = '#ef4444';

function circleToPolygon(center: [number, number], radiusM: number, segments = 64): [number, number][] {
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

const QUAD_SOURCE = 'perimeter-quad-source';
const QUAD_LAYER = 'perimeter-quad-layer';
const GAP_SOURCE = 'perimeter-gap-source';
const GAP_LAYER = 'perimeter-gap-layer';
const RING_SOURCE = 'perimeter-ring-source';
const RING_LAYER = 'perimeter-ring-layer';
const CONTAINMENT_SOURCE = 'perimeter-containment-source';
const CONTAINMENT_LAYER = 'perimeter-containment-layer';
const CONTAINMENT_VERTEX_SOURCE = 'perimeter-vertex-source';
const CONTAINMENT_VERTEX_LAYER = 'perimeter-vertex-layer';
const HVT_SOURCE = 'perimeter-hvt-source';
const HVT_LAYER = 'perimeter-hvt-layer';

function removeSourceAndLayer(map: mapboxgl.Map, layerId: string, sourceId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch { /* ignore */ }
}

export function useMapPerimeter(
  map: mapboxgl.Map | null,
  enabled: boolean,
): UseMapPerimeterReturn {
  const [loading, setLoading] = useState(false);
  const [coverageGaps, setCoverageGaps] = useState<CoverageGap[]>([]);
  const [coveragePercent, setCoveragePercent] = useState(0);
  const [stagingSuggestion, setStagingSuggestion] = useState<{ lat: number; lng: number } | null>(null);
  const [containmentPolygon, setContainmentPolygon] = useState<{ lat: number; lng: number }[]>([]);

  const hvtMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const clickHandlerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);
  const dblClickHandlerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);
  const isDrawingRef = useRef(false);
  const verticesRef = useRef<{ lat: number; lng: number }[]>([]);

  const clearQuadrants = useCallback(() => {
    if (map) removeSourceAndLayer(map, QUAD_LAYER, QUAD_SOURCE);
  }, [map]);

  const clearGapRects = useCallback(() => {
    if (map) removeSourceAndLayer(map, GAP_LAYER, GAP_SOURCE);
  }, [map]);

  const clearRings = useCallback(() => {
    if (map) removeSourceAndLayer(map, RING_LAYER, RING_SOURCE);
  }, [map]);

  const clearContainment = useCallback(() => {
    if (map) {
      removeSourceAndLayer(map, CONTAINMENT_LAYER, CONTAINMENT_SOURCE);
      removeSourceAndLayer(map, CONTAINMENT_VERTEX_LAYER, CONTAINMENT_VERTEX_SOURCE);
    }
    if (clickHandlerRef.current) { map?.off('click', clickHandlerRef.current); clickHandlerRef.current = null; }
    if (dblClickHandlerRef.current) { map?.off('dblclick', dblClickHandlerRef.current); dblClickHandlerRef.current = null; }
    isDrawingRef.current = false;
    verticesRef.current = [];
    setContainmentPolygon([]);
  }, [map]);

  const clearHvtMarkers = useCallback(() => {
    hvtMarkersRef.current.forEach((m) => m.remove());
    hvtMarkersRef.current = [];
  }, []);

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

  const renderHvtMarkers = useCallback(() => {
    if (!map) return;
    clearHvtMarkers();
    HIGH_VALUE_TARGETS.forEach((target) => {
      const el = document.createElement('div');
      el.style.cssText = `
        width: 10px; height: 14px;
        background: #888888;
        border: 1px solid #555555;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        cursor: pointer;
      `;
      el.title = target.name;
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([target.lng, target.lat])
        .addTo(map);
      hvtMarkersRef.current.push(marker);
    });
  }, [map, clearHvtMarkers]);

  const showPerimeter = useCallback(
    async (lat: number, lng: number) => {
      if (!enabled || !map) return;
      setLoading(true);
      try {
        const data = await apiFetch<PerimeterData>(`/map/safety/perimeter-check/${lat}/${lng}`);
        if (!data?.quadrants) return;
        clearQuadrants();
        clearGapRects();

        const SIZE = 0.005;
        const offsets: Record<string, { latOff: number; lngOff: number }> = {
          NE: { latOff: 0, lngOff: 0 },
          NW: { latOff: 0, lngOff: -SIZE },
          SE: { latOff: -SIZE, lngOff: 0 },
          SW: { latOff: -SIZE, lngOff: -SIZE },
        };

        const rectFeatures: GeoJSON.Feature[] = data.quadrants.map((q) => {
          const off = offsets[q.quadrant];
          if (!off) return null;
          const color = q.has_units ? COVERED_COLOR : GAP_COLOR;
          return {
            type: 'Feature' as const,
            properties: { color },
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [lng + off.lngOff, lat + off.latOff],
                [lng + off.lngOff + SIZE, lat + off.latOff],
                [lng + off.lngOff + SIZE, lat + off.latOff + SIZE],
                [lng + off.lngOff, lat + off.latOff + SIZE],
                [lng + off.lngOff, lat + off.latOff],
              ]],
            },
          };
        }).filter(Boolean) as GeoJSON.Feature[];

        if (rectFeatures.length > 0) {
          map.addSource(QUAD_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: rectFeatures } });
          map.addLayer({
            id: QUAD_LAYER,
            type: 'fill',
            source: QUAD_SOURCE,
            paint: {
              'fill-color': ['get', 'color'],
              'fill-opacity': 0.12,
              'fill-outline-color': ['get', 'color'],
            },
          });
        }

        const gapData = await apiFetch<CoverageGapData>('/map/safety/coverage-gaps');
        if (gapData) {
          setCoverageGaps(gapData.gaps || []);
          setCoveragePercent(gapData.coverage_percent || 0);
          setStagingSuggestion(gapData.suggested_staging || null);

          const gapFeatures: GeoJSON.Feature[] = (gapData.gaps || []).map((gap) => ({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [gap.lng - gap.width / 2, gap.lat - gap.height / 2],
                [gap.lng + gap.width / 2, gap.lat - gap.height / 2],
                [gap.lng + gap.width / 2, gap.lat + gap.height / 2],
                [gap.lng - gap.width / 2, gap.lat + gap.height / 2],
                [gap.lng - gap.width / 2, gap.lat - gap.height / 2],
              ]],
            },
          }));

          if (gapFeatures.length > 0) {
            map.addSource(GAP_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: gapFeatures } });
            map.addLayer({
              id: GAP_LAYER,
              type: 'fill',
              source: GAP_SOURCE,
              paint: {
                'fill-color': GAP_COLOR,
                'fill-opacity': 0.08,
                'fill-outline-color': GAP_COLOR,
              },
            });
          }
        }

        renderHvtMarkers();
      } catch (err) {
        console.warn('[useMapPerimeter] Perimeter analysis fetch failed:', err);
      } finally {
        setLoading(false);
      }
    },
    [enabled, map, clearQuadrants, clearGapRects, renderHvtMarkers],
  );

  const updateContainmentPoly = useCallback(() => {
    if (!map) return;
    removeSourceAndLayer(map, CONTAINMENT_LAYER, CONTAINMENT_SOURCE);
    removeSourceAndLayer(map, CONTAINMENT_VERTEX_LAYER, CONTAINMENT_VERTEX_SOURCE);

    if (verticesRef.current.length < 2) return;

    const coords: [number, number][] = verticesRef.current.map((v) => [v.lng, v.lat]);
    if (coords.length >= 3) {
      coords.push(coords[0]);
      const feature: GeoJSON.Feature = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] },
      };
      map.addSource(CONTAINMENT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [feature] } });
      map.addLayer({
        id: CONTAINMENT_LAYER,
        type: 'fill',
        source: CONTAINMENT_SOURCE,
        paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.06, 'fill-outline-color': '#ef4444' },
      });
    } else {
      const lineFeature: GeoJSON.Feature = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      };
      map.addSource(CONTAINMENT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [lineFeature] } });
      map.addLayer({
        id: CONTAINMENT_LAYER,
        type: 'line',
        source: CONTAINMENT_SOURCE,
        paint: { 'line-color': '#ef4444', 'line-width': 2, 'line-opacity': 0.9 },
      });
    }

    // Vertex markers
    const vertexFeatures: GeoJSON.Feature[] = verticesRef.current.map((v) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
    }));
    map.addSource(CONTAINMENT_VERTEX_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: vertexFeatures },
    });
    map.addLayer({
      id: CONTAINMENT_VERTEX_LAYER,
      type: 'circle',
      source: CONTAINMENT_VERTEX_SOURCE,
      paint: {
        'circle-color': '#ef4444',
        'circle-radius': 4,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
      },
    });
  }, [map]);

  const startContainment = useCallback(() => {
    if (!map || isDrawingRef.current) return;
    clearContainment();
    isDrawingRef.current = true;
    verticesRef.current = [];

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      if (!isDrawingRef.current) return;
      const point = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      verticesRef.current.push(point);
      updateContainmentPoly();
    };

    const onDblClick = () => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      if (clickHandlerRef.current) { map.off('click', clickHandlerRef.current); clickHandlerRef.current = null; }
      if (dblClickHandlerRef.current) { map.off('dblclick', dblClickHandlerRef.current); dblClickHandlerRef.current = null; }
      setContainmentPolygon([...verticesRef.current]);
      updateContainmentPoly();
    };

    clickHandlerRef.current = onClick;
    dblClickHandlerRef.current = onDblClick;
    map.on('click', onClick);
    map.on('dblclick', onDblClick);
  }, [map, clearContainment, updateContainmentPoly]);

  const endContainment = useCallback(() => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      if (clickHandlerRef.current) { map?.off('click', clickHandlerRef.current); clickHandlerRef.current = null; }
      if (dblClickHandlerRef.current) { map?.off('dblclick', dblClickHandlerRef.current); dblClickHandlerRef.current = null; }
      setContainmentPolygon([...verticesRef.current]);
    }
  }, [map]);

  const showPerimeterRings = useCallback(
    (lat: number, lng: number, innerM: number, outerM: number) => {
      if (!map) return;
      clearRings();

      const innerPoly = circleToPolygon([lng, lat], innerM);
      const outerPoly = circleToPolygon([lng, lat], outerM);

      const features: GeoJSON.Feature[] = [
        {
          type: 'Feature',
          properties: { color: '#ef4444' },
          geometry: { type: 'Polygon', coordinates: [innerPoly] },
        },
        {
          type: 'Feature',
          properties: { color: '#f59e0b' },
          geometry: { type: 'Polygon', coordinates: [outerPoly] },
        },
      ];

      map.addSource(RING_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: RING_LAYER,
        type: 'fill',
        source: RING_SOURCE,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.06,
          'fill-outline-color': ['get', 'color'],
        },
      });
    },
    [map, clearRings],
  );

  useEffect(() => {
    if (!enabled) clearPerimeter();
    return () => clearPerimeter();
  }, [enabled, clearPerimeter]);

  useEffect(() => {
    return () => {
      if (map) {
        removeSourceAndLayer(map, QUAD_LAYER, QUAD_SOURCE);
        removeSourceAndLayer(map, GAP_LAYER, GAP_SOURCE);
        removeSourceAndLayer(map, RING_LAYER, RING_SOURCE);
        removeSourceAndLayer(map, CONTAINMENT_LAYER, CONTAINMENT_SOURCE);
        removeSourceAndLayer(map, CONTAINMENT_VERTEX_LAYER, CONTAINMENT_VERTEX_SOURCE);
      }
      hvtMarkersRef.current.forEach((m) => m.remove());
      if (clickHandlerRef.current) map?.off('click', clickHandlerRef.current);
      if (dblClickHandlerRef.current) map?.off('dblclick', dblClickHandlerRef.current);
    };
  }, [map]);

  return {
    showPerimeter, clearPerimeter,
    coverageGaps, coveragePercent,
    startContainment, endContainment,
    containmentPolygon,
    showPerimeterRings, clearRings,
    stagingSuggestion, loading,
  };
}