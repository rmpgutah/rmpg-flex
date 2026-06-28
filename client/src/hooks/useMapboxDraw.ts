// ============================================================
// RMPG Flex — Mapbox GL Draw Integration Hook
// ============================================================
// Official @mapbox/mapbox-gl-draw integration for professional
// drawing & editing tools on the Mapbox map. Complements the
// existing custom useMapDrawing hook with vertex editing, feature
// selection, direct manipulation, and standard GeoJSON output.
//
// Mapbox Developer Cheatsheet: GL Draw (Developer Tools section)
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

// ── Draw theme matching Spillman Flex dark aesthetic ────────

const SPILLMAN_DRAW_STYLES: MapboxDraw.DrawCustomMode[] | object[] = [
  // Polygon fill — gold-tinted
  {
    id: 'gl-draw-polygon-fill-inactive',
    type: 'fill',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
    paint: { 'fill-color': '#d4a017', 'fill-outline-color': '#d4a017', 'fill-opacity': 0.1 },
  },
  {
    id: 'gl-draw-polygon-fill-active',
    type: 'fill',
    filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
    paint: { 'fill-color': '#d4a017', 'fill-outline-color': '#d4a017', 'fill-opacity': 0.15 },
  },
  // Polygon stroke
  {
    id: 'gl-draw-polygon-stroke-inactive',
    type: 'line',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#d4a017', 'line-width': 2, 'line-opacity': 0.7 },
  },
  {
    id: 'gl-draw-polygon-stroke-active',
    type: 'line',
    filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#d4a017', 'line-dasharray': [0.2, 2], 'line-width': 2 },
  },
  // Line
  {
    id: 'gl-draw-line-inactive',
    type: 'line',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#d4a017', 'line-width': 2, 'line-opacity': 0.7 },
  },
  {
    id: 'gl-draw-line-active',
    type: 'line',
    filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#d4a017', 'line-dasharray': [0.2, 2], 'line-width': 2 },
  },
  // Vertex points
  {
    id: 'gl-draw-polygon-and-line-vertex-stroke-inactive',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
    paint: { 'circle-radius': 5, 'circle-color': '#0a0a0a' },
  },
  {
    id: 'gl-draw-polygon-and-line-vertex-inactive',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
    paint: { 'circle-radius': 3, 'circle-color': '#d4a017' },
  },
  // Point
  {
    id: 'gl-draw-point-point-stroke-inactive',
    type: 'circle',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: { 'circle-radius': 6, 'circle-opacity': 1, 'circle-color': '#0a0a0a' },
  },
  {
    id: 'gl-draw-point-inactive',
    type: 'circle',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: { 'circle-radius': 4, 'circle-color': '#d4a017' },
  },
  {
    id: 'gl-draw-point-stroke-active',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'active', 'true'], ['!=', 'meta', 'midpoint']],
    paint: { 'circle-radius': 8, 'circle-color': '#0a0a0a' },
  },
  {
    id: 'gl-draw-point-active',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['!=', 'meta', 'midpoint'], ['==', 'active', 'true']],
    paint: { 'circle-radius': 5, 'circle-color': '#d4a017' },
  },
  // Midpoints
  {
    id: 'gl-draw-polygon-midpoint',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
    paint: { 'circle-radius': 3, 'circle-color': '#888888' },
  },
  // Static styles
  {
    id: 'gl-draw-polygon-fill-static',
    type: 'fill',
    filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Polygon']],
    paint: { 'fill-color': '#444', 'fill-outline-color': '#444', 'fill-opacity': 0.1 },
  },
  {
    id: 'gl-draw-polygon-stroke-static',
    type: 'line',
    filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Polygon']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#444', 'line-width': 2 },
  },
  {
    id: 'gl-draw-line-static',
    type: 'line',
    filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'LineString']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#444', 'line-width': 2 },
  },
  {
    id: 'gl-draw-point-static',
    type: 'circle',
    filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Point']],
    paint: { 'circle-radius': 5, 'circle-color': '#444' },
  },
];

// ── Types ──────────────────────────────────────────────────

export type DrawMode = 'simple_select' | 'direct_select' | 'draw_polygon' | 'draw_line_string' | 'draw_point' | 'static';

export interface UseMapboxDrawResult {
  /** Whether GL Draw is active on the map */
  enabled: boolean;
  /** Toggle GL Draw on/off */
  toggle: () => void;
  /** Enable GL Draw */
  enable: () => void;
  /** Disable and remove GL Draw */
  disable: () => void;
  /** Set the current drawing mode */
  setMode: (mode: DrawMode) => void;
  /** Current drawing mode */
  currentMode: DrawMode;
  /** Number of drawn features */
  featureCount: number;
  /** Get all features as GeoJSON */
  getAll: () => GeoJSON.FeatureCollection;
  /** Delete selected features */
  deleteSelected: () => void;
  /** Delete all features */
  deleteAll: () => void;
  /** Add a GeoJSON feature to the draw instance */
  addFeature: (feature: GeoJSON.Feature) => string[];
  /** Combine selected features */
  combineFeatures: () => void;
  /** Uncombine selected features */
  uncombineFeatures: () => void;
  /** Trash selected features (keyboard shortcut-friendly) */
  trash: () => void;
}

// ── Hook ───────────────────────────────────────────────────

export function useMapboxDraw(
  map: mapboxgl.Map | null,
  mapLoaded: boolean
): UseMapboxDrawResult {
  const drawRef = useRef<MapboxDraw | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [currentMode, setCurrentMode] = useState<DrawMode>('simple_select');
  const [featureCount, setFeatureCount] = useState(0);

  // Track feature count changes
  const updateFeatureCount = useCallback(() => {
    if (drawRef.current) {
      const all = drawRef.current.getAll();
      setFeatureCount(all.features.length);
    } else {
      setFeatureCount(0);
    }
  }, []);

  // Initialize GL Draw
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;

    // Don't double-add
    if (drawRef.current) return;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        line_string: true,
        point: true,
        trash: true,
        combine_features: true,
        uncombine_features: true,
      },
      styles: SPILLMAN_DRAW_STYLES as any,
      defaultMode: 'simple_select',
    });

    map.addControl(draw as unknown as mapboxgl.IControl, 'top-right');
    drawRef.current = draw;

    // Listen for draw events
    const onDrawCreate = () => updateFeatureCount();
    const onDrawDelete = () => updateFeatureCount();
    const onDrawUpdate = () => updateFeatureCount();
    const onDrawModeChange = (e: { mode: string }) => {
      setCurrentMode(e.mode as DrawMode);
    };
    const onDrawSelectionChange = () => updateFeatureCount();

    map.on('draw.create', onDrawCreate);
    map.on('draw.delete', onDrawDelete);
    map.on('draw.update', onDrawUpdate);
    map.on('draw.modechange', onDrawModeChange);
    map.on('draw.selectionchange', onDrawSelectionChange);

    return () => {
      map.off('draw.create', onDrawCreate);
      map.off('draw.delete', onDrawDelete);
      map.off('draw.update', onDrawUpdate);
      map.off('draw.modechange', onDrawModeChange);
      map.off('draw.selectionchange', onDrawSelectionChange);

      try {
        map.removeControl(draw as unknown as mapboxgl.IControl);
      } catch {
        /* map may already be destroyed */
      }
      drawRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- updateFeatureCount is stable (empty deps)
  }, [map, mapLoaded, enabled]);

  // Cleanup on unmount (safety net)
  useEffect(() => {
    return () => {
      if (drawRef.current && map) {
        try {
          map.removeControl(drawRef.current as unknown as mapboxgl.IControl);
        } catch {
          /* safe */
        }
        drawRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only cleanup
  }, []);

  const toggle = useCallback(() => setEnabled(v => !v), []);
  const enable = useCallback(() => setEnabled(true), []);
  const disable = useCallback(() => {
    if (drawRef.current && map) {
      try {
        map.removeControl(drawRef.current as unknown as mapboxgl.IControl);
      } catch { /* safe */ }
      drawRef.current = null;
    }
    setEnabled(false);
    setFeatureCount(0);
    setCurrentMode('simple_select');
  }, [map]);

  const setMode = useCallback((mode: DrawMode) => {
    if (drawRef.current) {
      drawRef.current.changeMode(mode as string);
      setCurrentMode(mode);
    }
  }, []);

  const getAll = useCallback((): GeoJSON.FeatureCollection => {
    if (drawRef.current) return drawRef.current.getAll();
    return { type: 'FeatureCollection', features: [] };
  }, []);

  const deleteSelected = useCallback(() => {
    if (!drawRef.current) return;
    const selected = drawRef.current.getSelectedIds();
    if (selected.length > 0) {
      drawRef.current.delete(selected);
      updateFeatureCount();
    }
  }, [updateFeatureCount]);

  const deleteAll = useCallback(() => {
    if (!drawRef.current) return;
    drawRef.current.deleteAll();
    updateFeatureCount();
  }, [updateFeatureCount]);

  const addFeature = useCallback((feature: GeoJSON.Feature): string[] => {
    if (!drawRef.current) return [];
    const ids = drawRef.current.add(feature as any);
    updateFeatureCount();
    return ids;
  }, [updateFeatureCount]);

  const combineFeatures = useCallback(() => {
    if (drawRef.current) drawRef.current.combineFeatures();
  }, []);

  const uncombineFeatures = useCallback(() => {
    if (drawRef.current) drawRef.current.uncombineFeatures();
  }, []);

  const trash = useCallback(() => {
    if (drawRef.current) {
      drawRef.current.trash();
      updateFeatureCount();
    }
  }, [updateFeatureCount]);

  return {
    enabled,
    toggle,
    enable,
    disable,
    setMode,
    currentMode,
    featureCount,
    getAll,
    deleteSelected,
    deleteAll,
    addFeature,
    combineFeatures,
    uncombineFeatures,
    trash,
  };
}
