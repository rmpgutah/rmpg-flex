// ============================================================
// RMPG Flex — Measure & Draw tool
// ============================================================
// Click to drop vertices; a live polyline (distance) or polygon (area +
// perimeter) is drawn and measured with turf. Double-click finishes. The
// shape stays on the map so the existing map export captures it. Useful
// for staging distances, perimeters, and search grids.
//
// Modes: 'distance' (polyline length), 'area' (polygon area+perimeter).
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { mapboxgl } from '../utils/mapboxLoader';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import { length as turfLength } from '@turf/length';
import { area as turfArea } from '@turf/area';
import { getSourceSafe, hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';

export type MeasureMode = 'distance' | 'area' | null;

const SRC = 'measure-src';
const L_FILL = 'measure-fill';
const L_LINE = 'measure-line';
const L_VERT = 'measure-vert';

export interface MeasureResult {
  points: number;
  distanceMeters: number; // polyline length (or polygon perimeter in area mode)
  areaSqMeters: number;   // 0 unless area mode with >=3 points
}

interface Opts { map: mapboxgl.Map | null; mode: MeasureMode; }

export function useMapMeasureDraw({ map, mode }: Opts) {
  const [result, setResult] = useState<MeasureResult>({ points: 0, distanceMeters: 0, areaSqMeters: 0 });
  const ptsRef = useRef<[number, number][]>([]);
  const modeRef = useRef<MeasureMode>(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const buildData = useCallback(() => {
    const pts = ptsRef.current;
    const features: any[] = [];
    for (const p of pts) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } });
    if (pts.length >= 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
    if (modeRef.current === 'area' && pts.length >= 3) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } });
    }
    return { type: 'FeatureCollection', features };
  }, []);

  const ensureLayers = useCallback(() => {
    if (!map) return;
    whenStyleReady(map, () => {
      if (!hasSource(map, SRC)) map.addSource(SRC, { type: 'geojson', data: buildData() as any });
      if (!hasLayer(map, L_FILL)) {
        map.addLayer({ id: L_FILL, type: 'fill', source: SRC, filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': '#c3ccd6', 'fill-opacity': 0.15 } });
      }
      if (!hasLayer(map, L_LINE)) {
        map.addLayer({ id: L_LINE, type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'LineString'],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#c3ccd6', 'line-width': 2.5, 'line-dasharray': [2, 1] } });
      }
      if (!hasLayer(map, L_VERT)) {
        map.addLayer({ id: L_VERT, type: 'circle', source: SRC, filter: ['==', ['geometry-type'], 'Point'],
          paint: { 'circle-radius': 4, 'circle-color': '#0a0a0a', 'circle-stroke-color': '#c3ccd6', 'circle-stroke-width': 2 } });
      }
    });
  }, [map, buildData]);

  const refresh = useCallback(() => {
    if (!map) return;
    ensureLayers();
    const data = buildData();
    const src = getSourceSafe<mapboxgl.GeoJSONSource>(map, SRC);
    if (src) src.setData(data as any);
    const pts = ptsRef.current;
    let dist = 0;
    let area = 0;
    if (pts.length >= 2) {
      dist = turfLength({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } } as any, { units: 'meters' });
    }
    if (modeRef.current === 'area' && pts.length >= 3) {
      const ring = [...pts, pts[0]];
      area = turfArea({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } } as any);
      // perimeter for area mode
      dist = turfLength({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } } as any, { units: 'meters' });
    }
    setResult({ points: pts.length, distanceMeters: dist, areaSqMeters: area });
  }, [map, buildData, ensureLayers]);

  const clearMeasure = useCallback(() => {
    ptsRef.current = [];
    refresh();
  }, [refresh]);

  // Click to add a vertex; double-click to finish (and not zoom).
  useEffect(() => {
    if (!map) return;
    const onClick = (e: mapboxgl.MapMouseEvent) => {
      if (!modeRef.current) return;
      ptsRef.current = [...ptsRef.current, [e.lngLat.lng, e.lngLat.lat]];
      refresh();
    };
    const onDblClick = (e: mapboxgl.MapMouseEvent) => {
      if (!modeRef.current) return;
      e.preventDefault(); // stop the zoom; double-click just finishes the shape
    };
    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    return () => { map.off('click', onClick); map.off('dblclick', onDblClick); };
  }, [map, refresh]);

  // Toggle double-click-zoom off while measuring so finishing doesn't zoom.
  useEffect(() => {
    if (!map) return;
    try {
      if (mode) map.doubleClickZoom.disable();
      else map.doubleClickZoom.enable();
    } catch { /* */ }
  }, [map, mode]);

  // Re-add layers after a basemap switch if a measurement is in progress.
  useEffect(() => {
    if (!map) return;
    const onLoad = () => { if (ptsRef.current.length) refresh(); };
    map.on('style.load', onLoad);
    return () => { map.off('style.load', onLoad); };
  }, [map, refresh]);

  // Remove the measure source + layers on map change / unmount so teardown
  // doesn't leak an orphaned source+layers (mirrors useMapboxResponseTime).
  useEffect(() => {
    if (!map) return;
    return () => {
      [L_VERT, L_LINE, L_FILL].forEach((id) => safeRemoveLayer(map, id));
      safeRemoveSource(map, SRC);
    };
  }, [map]);

  return { measureResult: result, clearMeasure };
}
