// ============================================================
// RMPG Flex — useMapDrawing Hook
// ============================================================
// Drawing tools for the Mapbox map — polygons, polylines, and
// circles for geofencing, perimeter zones, and area selection.
// Replaces Google Maps Drawing Manager functionality.
//
// Uses native Mapbox GL sources/layers + click handlers rather
// than a heavy third-party drawing library.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { devLog } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export type DrawingMode = 'none' | 'polygon' | 'polyline' | 'circle';

export interface DrawnShape {
  id: string;
  type: 'polygon' | 'polyline' | 'circle';
  coordinates: [number, number][];
  /** Circle radius in meters (only for type === 'circle') */
  radiusMeters?: number;
  /** Center point (only for type === 'circle') */
  center?: [number, number];
  color: string;
  createdAt: number;
}

export interface UseMapDrawingResult {
  mode: DrawingMode;
  shapes: DrawnShape[];
  activeShape: DrawnShape | null;
  setMode: (mode: DrawingMode) => void;
  clearAll: () => void;
  removeShape: (id: string) => void;
  undo: () => void;
}

// ── Constants ─────────────────────────────────────────────

const DRAW_SOURCE = 'rmpg-draw';
const DRAW_FILL = 'rmpg-draw-fill';
const DRAW_LINE = 'rmpg-draw-line';
const DRAW_POINTS = 'rmpg-draw-points';
const DRAW_ACTIVE_SOURCE = 'rmpg-draw-active';
const DRAW_ACTIVE_LINE = 'rmpg-draw-active-line';
const DRAW_ACTIVE_POINTS = 'rmpg-draw-active-points';

const SHAPE_COLORS = ['#d4a017', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#f59e0b'];

function nextColor(index: number): string {
  return SHAPE_COLORS[index % SHAPE_COLORS.length];
}

function uid(): string {
  return `draw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Generate a GeoJSON circle polygon from center + radius (meters). */
function circlePolygon(center: [number, number], radiusMeters: number, steps = 64): [number, number][] {
  const coords: [number, number][] = [];
  const distanceX = radiusMeters / (111320 * Math.cos((center[1] * Math.PI) / 180));
  const distanceY = radiusMeters / 110540;
  for (let i = 0; i < steps; i++) {
    const theta = (i / steps) * (2 * Math.PI);
    const x = center[0] + distanceX * Math.cos(theta);
    const y = center[1] + distanceY * Math.sin(theta);
    coords.push([x, y]);
  }
  coords.push(coords[0]); // close ring
  return coords;
}

/** Build a FeatureCollection from completed shapes. */
function shapesToGeoJSON(shapes: DrawnShape[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const s of shapes) {
    if (s.type === 'polyline') {
      features.push({
        type: 'Feature',
        properties: { id: s.id, color: s.color, shapeType: 'polyline' },
        geometry: { type: 'LineString', coordinates: s.coordinates },
      });
    } else if (s.type === 'polygon') {
      features.push({
        type: 'Feature',
        properties: { id: s.id, color: s.color, shapeType: 'polygon' },
        geometry: { type: 'Polygon', coordinates: [s.coordinates] },
      });
    } else if (s.type === 'circle' && s.center && s.radiusMeters) {
      const ring = circlePolygon(s.center, s.radiusMeters);
      features.push({
        type: 'Feature',
        properties: { id: s.id, color: s.color, shapeType: 'circle' },
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

// ── Hook ──────────────────────────────────────────────────

export function useMapDrawing(map: mapboxgl.Map | null, mapLoaded: boolean): UseMapDrawingResult {
  const [mode, setModeState] = useState<DrawingMode>('none');
  const [shapes, setShapes] = useState<DrawnShape[]>([]);
  const [activeShape, setActiveShape] = useState<DrawnShape | null>(null);
  const activePointsRef = useRef<[number, number][]>([]);
  const circleCenterRef = useRef<[number, number] | null>(null);

  // Sync completed shapes to the map source
  const syncShapes = useCallback((s: DrawnShape[]) => {
    if (!map || !map.getSource(DRAW_SOURCE)) return;
    (map.getSource(DRAW_SOURCE) as mapboxgl.GeoJSONSource).setData(shapesToGeoJSON(s));
  }, [map]);

  // Sync the in-progress shape
  const syncActive = useCallback((pts: [number, number][], drawMode: DrawingMode) => {
    if (!map || !map.getSource(DRAW_ACTIVE_SOURCE)) return;
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    if (pts.length >= 2) {
      if (drawMode === 'polyline' || drawMode === 'polygon') {
        fc.features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: pts },
        });
      }
    }
    if (pts.length > 0) {
      fc.features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiPoint', coordinates: pts },
      });
    }
    (map.getSource(DRAW_ACTIVE_SOURCE) as mapboxgl.GeoJSONSource).setData(fc);
  }, [map]);

  // Initialize drawing layers
  useEffect(() => {
    if (!map || !mapLoaded) return;

    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

    if (!map.getSource(DRAW_SOURCE)) {
      map.addSource(DRAW_SOURCE, { type: 'geojson', data: empty });
      map.addLayer({
        id: DRAW_FILL, type: 'fill', source: DRAW_SOURCE,
        filter: ['in', ['get', 'shapeType'], ['literal', ['polygon', 'circle']]],
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.15 },
      });
      map.addLayer({
        id: DRAW_LINE, type: 'line', source: DRAW_SOURCE,
        paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.8 },
      });
      map.addLayer({
        id: DRAW_POINTS, type: 'circle', source: DRAW_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-color': '#d4a017', 'circle-radius': 4 },
      });
    }

    if (!map.getSource(DRAW_ACTIVE_SOURCE)) {
      map.addSource(DRAW_ACTIVE_SOURCE, { type: 'geojson', data: empty });
      map.addLayer({
        id: DRAW_ACTIVE_LINE, type: 'line', source: DRAW_ACTIVE_SOURCE,
        paint: { 'line-color': '#d4a017', 'line-width': 2, 'line-dasharray': [2, 2] },
      });
      map.addLayer({
        id: DRAW_ACTIVE_POINTS, type: 'circle', source: DRAW_ACTIVE_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-color': '#d4a017', 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      });
    }

    return () => {
      [DRAW_ACTIVE_POINTS, DRAW_ACTIVE_LINE, DRAW_POINTS, DRAW_LINE, DRAW_FILL].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      [DRAW_ACTIVE_SOURCE, DRAW_SOURCE].forEach(id => {
        if (map.getSource(id)) map.removeSource(id);
      });
    };
  }, [map, mapLoaded]);

  // Click handler for drawing
  useEffect(() => {
    if (!map || !mapLoaded || mode === 'none') return;

    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      if (mode === 'circle') {
        if (!circleCenterRef.current) {
          circleCenterRef.current = pt;
          activePointsRef.current = [pt];
          syncActive([pt], mode);
        } else {
          const center = circleCenterRef.current;
          const dx = pt[0] - center[0];
          const dy = pt[1] - center[1];
          const radius = Math.sqrt(dx * dx + dy * dy) * 111320;
          const ring = circlePolygon(center, radius);
          const shape: DrawnShape = {
            id: uid(), type: 'circle', coordinates: ring,
            center, radiusMeters: radius, color: nextColor(shapes.length),
            createdAt: Date.now(),
          };
          setShapes(prev => { const next = [...prev, shape]; syncShapes(next); return next; });
          setActiveShape(shape);
          circleCenterRef.current = null;
          activePointsRef.current = [];
          syncActive([], mode);
          devLog('[Drawing] Circle completed', shape);
        }
        return;
      }

      activePointsRef.current.push(pt);
      syncActive(activePointsRef.current, mode);
    };

    const onDblClick = (e: mapboxgl.MapMouseEvent) => {
      e.preventDefault();
      const pts = activePointsRef.current;
      if (pts.length < 2) return;

      if (mode === 'polygon' && pts.length >= 3) {
        const closed = [...pts, pts[0]];
        const shape: DrawnShape = {
          id: uid(), type: 'polygon', coordinates: closed,
          color: nextColor(shapes.length), createdAt: Date.now(),
        };
        setShapes(prev => { const next = [...prev, shape]; syncShapes(next); return next; });
        setActiveShape(shape);
        devLog('[Drawing] Polygon completed', shape);
      } else if (mode === 'polyline') {
        const shape: DrawnShape = {
          id: uid(), type: 'polyline', coordinates: [...pts],
          color: nextColor(shapes.length), createdAt: Date.now(),
        };
        setShapes(prev => { const next = [...prev, shape]; syncShapes(next); return next; });
        setActiveShape(shape);
        devLog('[Drawing] Polyline completed', shape);
      }

      activePointsRef.current = [];
      syncActive([], mode);
    };

    const onContextMenu = (e: mapboxgl.MapMouseEvent) => {
      e.preventDefault();
      // Right-click cancels active drawing
      activePointsRef.current = [];
      circleCenterRef.current = null;
      syncActive([], mode);
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    map.on('contextmenu', onContextMenu);

    return () => {
      canvas.style.cursor = '';
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.off('contextmenu', onContextMenu);
    };
  }, [map, mapLoaded, mode, shapes.length, syncActive, syncShapes]);

  const setMode = useCallback((m: DrawingMode) => {
    activePointsRef.current = [];
    circleCenterRef.current = null;
    if (map && map.getSource(DRAW_ACTIVE_SOURCE)) {
      (map.getSource(DRAW_ACTIVE_SOURCE) as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
    }
    setModeState(m);
  }, [map]);

  const clearAll = useCallback(() => {
    setShapes([]);
    setActiveShape(null);
    activePointsRef.current = [];
    circleCenterRef.current = null;
    if (map) {
      if (map.getSource(DRAW_SOURCE)) {
        (map.getSource(DRAW_SOURCE) as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
      }
      if (map.getSource(DRAW_ACTIVE_SOURCE)) {
        (map.getSource(DRAW_ACTIVE_SOURCE) as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
      }
    }
  }, [map]);

  const removeShape = useCallback((id: string) => {
    setShapes(prev => {
      const next = prev.filter(s => s.id !== id);
      syncShapes(next);
      return next;
    });
  }, [syncShapes]);

  const undo = useCallback(() => {
    setShapes(prev => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      syncShapes(next);
      return next;
    });
  }, [syncShapes]);

  return { mode, shapes, activeShape, setMode, clearAll, removeShape, undo };
}
