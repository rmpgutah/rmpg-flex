// ============================================================
// RMPG Flex — useMapMeasure Hook
// ============================================================
// Distance and area measurement tool for the Mapbox map.
// Replaces Google Maps MeasureTool / geometry library.
// Click to add points, double-click to finish. Displays
// total distance (polyline) or area (polygon) in real-time.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { devLog } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export type MeasureMode = 'none' | 'distance' | 'area';

export interface MeasureResult {
  /** Total distance in meters (for distance mode) or perimeter (for area mode) */
  distanceMeters: number;
  /** Formatted distance string (e.g. "2.4 mi") */
  distanceFormatted: string;
  /** Area in square meters (only for area mode) */
  areaSqMeters?: number;
  /** Formatted area string (e.g. "15.3 acres") */
  areaFormatted?: string;
  /** Points clicked */
  points: [number, number][];
}

export interface UseMapMeasureResult {
  mode: MeasureMode;
  setMode: (m: MeasureMode) => void;
  result: MeasureResult | null;
  clear: () => void;
}

// ── Geo math ──────────────────────────────────────────────

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function totalDistance(pts: [number, number][]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
  return d;
}

/** Shoelace formula on geodesic coordinates (approximate for small areas). */
function polygonArea(pts: [number, number][]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const xi = pts[i][0] * (Math.PI / 180);
    const yi = pts[i][1] * (Math.PI / 180);
    const xj = pts[j][0] * (Math.PI / 180);
    const yj = pts[j][1] * (Math.PI / 180);
    area += (xj - xi) * (2 + Math.sin(yi) + Math.sin(yj));
  }
  area = (Math.abs(area) * 6371000 * 6371000) / 2;
  return area;
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  if (miles >= 0.1) return `${miles.toFixed(2)} mi`;
  const feet = meters * 3.28084;
  return `${Math.round(feet)} ft`;
}

function formatArea(sqMeters: number): string {
  const acres = sqMeters / 4046.86;
  if (acres >= 1) return `${acres.toFixed(2)} acres`;
  const sqFeet = sqMeters * 10.7639;
  return `${Math.round(sqFeet).toLocaleString()} sq ft`;
}

// ── Constants ─────────────────────────────────────────────

const MEAS_SOURCE = 'rmpg-measure';
const MEAS_LINE = 'rmpg-measure-line';
const MEAS_FILL = 'rmpg-measure-fill';
const MEAS_POINTS = 'rmpg-measure-points';
const MEAS_LABEL = 'rmpg-measure-label';

// ── Hook ──────────────────────────────────────────────────

export function useMapMeasure(map: mapboxgl.Map | null, mapLoaded: boolean): UseMapMeasureResult {
  const [mode, setModeState] = useState<MeasureMode>('none');
  const [result, setResult] = useState<MeasureResult | null>(null);
  const pointsRef = useRef<[number, number][]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const syncSource = useCallback((pts: [number, number][], m: MeasureMode) => {
    if (!map || !map.getSource(MEAS_SOURCE)) return;
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

    if (pts.length >= 2) {
      const closed = m === 'area' ? [...pts, pts[0]] : pts;
      fc.features.push({
        type: 'Feature',
        properties: {},
        geometry: m === 'area' && pts.length >= 3
          ? { type: 'Polygon', coordinates: [closed] }
          : { type: 'LineString', coordinates: closed },
      });
    }
    if (pts.length > 0) {
      fc.features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiPoint', coordinates: pts },
      });
    }
    (map.getSource(MEAS_SOURCE) as mapboxgl.GeoJSONSource).setData(fc);
  }, [map]);

  const computeResult = useCallback((pts: [number, number][], m: MeasureMode): MeasureResult => {
    const dist = totalDistance(m === 'area' && pts.length >= 3 ? [...pts, pts[0]] : pts);
    const res: MeasureResult = {
      distanceMeters: dist,
      distanceFormatted: formatDistance(dist),
      points: [...pts],
    };
    if (m === 'area' && pts.length >= 3) {
      const a = polygonArea(pts);
      res.areaSqMeters = a;
      res.areaFormatted = formatArea(a);
    }
    return res;
  }, []);

  // Initialize layers
  useEffect(() => {
    if (!map || !mapLoaded) return;
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

    if (!map.getSource(MEAS_SOURCE)) {
      map.addSource(MEAS_SOURCE, { type: 'geojson', data: empty });
      map.addLayer({
        id: MEAS_FILL, type: 'fill', source: MEAS_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.1 },
      });
      map.addLayer({
        id: MEAS_LINE, type: 'line', source: MEAS_SOURCE,
        paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [3, 2] },
      });
      map.addLayer({
        id: MEAS_POINTS, type: 'circle', source: MEAS_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-color': '#3b82f6', 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      });
    }

    return () => {
      [MEAS_POINTS, MEAS_LINE, MEAS_FILL].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(MEAS_SOURCE)) map.removeSource(MEAS_SOURCE);
      popupRef.current?.remove();
    };
  }, [map, mapLoaded]);

  // Click handler
  useEffect(() => {
    if (!map || !mapLoaded || mode === 'none') return;

    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      pointsRef.current.push(pt);
      syncSource(pointsRef.current, mode);

      const res = computeResult(pointsRef.current, mode);
      setResult(res);

      // Show live measurement popup
      popupRef.current?.remove();
      const label = mode === 'area' && res.areaFormatted
        ? `${res.distanceFormatted} | ${res.areaFormatted}`
        : res.distanceFormatted;
      popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'mapbox-popup-dark' })
        .setLngLat(pt)
        .setHTML(`<div style="background:#141414;color:#3b82f6;padding:4px 8px;font-size:11px;font-family:ui-monospace,monospace;border:1px solid #222;border-radius:2px;">${label}</div>`)
        .addTo(map);
    };

    const onDblClick = (e: mapboxgl.MapMouseEvent) => {
      e.preventDefault();
      // Finalize measurement — keep display but stop adding points
      const res = computeResult(pointsRef.current, mode);
      setResult(res);
      setModeState('none');
      canvas.style.cursor = '';
      devLog('[Measure] Completed:', res);
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);

    return () => {
      canvas.style.cursor = '';
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
    };
  }, [map, mapLoaded, mode, syncSource, computeResult]);

  const setMode = useCallback((m: MeasureMode) => {
    pointsRef.current = [];
    setResult(null);
    popupRef.current?.remove();
    popupRef.current = null;
    if (map && map.getSource(MEAS_SOURCE)) {
      (map.getSource(MEAS_SOURCE) as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
    }
    setModeState(m);
  }, [map]);

  const clear = useCallback(() => {
    pointsRef.current = [];
    setResult(null);
    popupRef.current?.remove();
    popupRef.current = null;
    if (map && map.getSource(MEAS_SOURCE)) {
      (map.getSource(MEAS_SOURCE) as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
    }
    setModeState('none');
  }, [map]);

  return { mode, setMode, result, clear };
}
