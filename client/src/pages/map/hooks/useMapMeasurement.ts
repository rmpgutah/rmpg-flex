import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';

export type MeasureMode = 'distance' | 'area';

export interface SegmentInfo {
  fromIdx: number;
  toIdx: number;
  meters: number;
  displayFt: string;
  displayM: string;
}

export interface MeasurementState {
  measuring: boolean;
  measureMode: MeasureMode | null;
  measureValue: number;
  measureUnit: string;
  measureDisplay: string;
  measureDisplayMetric: string;
  segments: SegmentInfo[];
  perimeterDisplay: string;
  areaDisplay: string;
  pointCount: number;
  startMeasure: (map: mapboxgl.Map, mode: MeasureMode) => void;
  finishMeasurement: () => void;
  clearMeasurement: () => void;
  undoLastPoint: () => void;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return 0;
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeSphericalArea(path: { lat: number; lng: number }[]): number {
  const validPath = path.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (validPath.length < 3) return 0;
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  let total = 0;
  for (let i = 0; i < validPath.length; i++) {
    const j = (i + 1) % validPath.length;
    const lat1 = toRad(validPath[i].lat);
    const lng1 = toRad(validPath[i].lng);
    const lat2 = toRad(validPath[j].lat);
    const lng2 = toRad(validPath[j].lng);
    total += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs((total * R * R) / 2);
}

function formatDistance(meters: number): { value: number; unit: string; display: string } {
  const feet = meters * 3.28084;
  if (feet < 1000) return { value: feet, unit: 'ft', display: `${Math.round(feet).toLocaleString()} ft` };
  const miles = feet / 5280;
  return { value: miles, unit: 'mi', display: `${miles.toFixed(2)} mi` };
}

function formatDistanceMetric(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatAreaMetric(sqMeters: number): string {
  if (sqMeters < 10000) return `${Math.round(sqMeters).toLocaleString()} sq m`;
  return `${(sqMeters / 10000).toFixed(2)} hectares`;
}

function formatArea(sqMeters: number): { value: number; unit: string; display: string } {
  const sqFeet = sqMeters * 10.7639;
  if (sqFeet < 43560) return { value: sqFeet, unit: 'sq ft', display: `${Math.round(sqFeet).toLocaleString()} sq ft` };
  const acres = sqFeet / 43560;
  return { value: acres, unit: 'acres', display: `${acres.toFixed(2)} acres` };
}

const LINE_SOURCE = 'measure-line-source';
const LINE_LAYER = 'measure-line-layer';
const POLYGON_SOURCE = 'measure-polygon-source';
const POLYGON_LAYER = 'measure-polygon-layer';
const VERTEX_SOURCE = 'measure-vertex-source';
const VERTEX_LAYER = 'measure-vertex-layer';

function removeSourceAndLayer(map: mapboxgl.Map, layerId: string, sourceId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch { /* ignore */ }
}

export function useMapMeasurement(): MeasurementState {
  const [measuring, setMeasuring] = useState(false);
  const [measureMode, setMeasureMode] = useState<MeasureMode | null>(null);
  const [measureValue, setMeasureValue] = useState(0);
  const [measureUnit, setMeasureUnit] = useState('');
  const [measureDisplay, setMeasureDisplay] = useState('');
  const [measureDisplayMetric, setMeasureDisplayMetric] = useState('');
  const [segments, setSegments] = useState<SegmentInfo[]>([]);
  const [perimeterDisplay, setPerimeterDisplay] = useState('');
  const [areaDisplay, setAreaDisplay] = useState('');
  const [pointCount, setPointCount] = useState(0);

  const pathRef = useRef<{ lat: number; lng: number }[]>([]);
  const segmentLabelsRef = useRef<mapboxgl.Popup[]>([]);
  const clickHandlerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);
  const dblClickHandlerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const modeRef = useRef<MeasureMode | null>(null);

  const clearSegmentLabels = useCallback(() => {
    segmentLabelsRef.current.forEach(iw => iw.remove());
    segmentLabelsRef.current = [];
  }, []);

  const renderSegmentLabels = useCallback((segs: SegmentInfo[]) => {
    clearSegmentLabels();
    const m = mapRef.current;
    const path = pathRef.current;
    if (!m || segs.length === 0) return;
    segs.forEach((seg) => {
      const p1 = path[seg.fromIdx];
      const p2 = path[seg.toIdx];
      if (!p1 || !p2) return;
      const midLng = (p1.lng + p2.lng) / 2;
      const midLat = (p1.lat + p2.lat) / 2;
      const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, closeOnMove: false })
        .setLngLat([midLng, midLat])
        .setHTML(`<div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#d4a017;background:#0c0c0c;padding:2px 6px;border:1px solid #d4a01740;border-radius:2px;white-space:nowrap;">${seg.displayFt} / ${seg.displayM}</div>`)
        .addTo(m);
      segmentLabelsRef.current.push(popup);
    });
  }, [clearSegmentLabels]);

  const updateMeasurement = useCallback(() => {
    const path = pathRef.current;
    const mode = modeRef.current;
    setPointCount(path.length);

    if (mode === 'distance') {
      let totalMeters = 0;
      const segs: SegmentInfo[] = [];
      for (let i = 1; i < path.length; i++) {
        const segMeters = haversineMeters(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
        totalMeters += segMeters;
        const segFeet = segMeters * 3.28084;
        segs.push({
          fromIdx: i - 1, toIdx: i, meters: segMeters,
          displayFt: segFeet < 1000 ? `${Math.round(segFeet)} ft` : `${(segFeet / 5280).toFixed(2)} mi`,
          displayM: formatDistanceMetric(segMeters),
        });
      }
      setSegments(segs);
      const fmt = formatDistance(totalMeters);
      setMeasureValue(fmt.value);
      setMeasureUnit(fmt.unit);
      setMeasureDisplay(fmt.display);
      setMeasureDisplayMetric(formatDistanceMetric(totalMeters));
      if (path.length >= 3) {
        const closingMeters = haversineMeters(path[path.length - 1].lat, path[path.length - 1].lng, path[0].lat, path[0].lng);
        const perimMeters = totalMeters + closingMeters;
        const perimFmt = formatDistance(perimMeters);
        setPerimeterDisplay(`Perimeter: ${perimFmt.display} / ${formatDistanceMetric(perimMeters)}`);
        const sqm = computeSphericalArea(path);
        const areaFmt = formatArea(sqm);
        setAreaDisplay(`Area: ${areaFmt.display} / ${formatAreaMetric(sqm)}`);
      } else {
        setPerimeterDisplay('');
        setAreaDisplay('');
      }
      renderSegmentLabels(segs);
    } else if (mode === 'area') {
      const sqm = computeSphericalArea(path);
      const fmt = formatArea(sqm);
      setMeasureValue(fmt.value);
      setMeasureUnit(fmt.unit);
      setMeasureDisplay(fmt.display);
      setMeasureDisplayMetric(formatAreaMetric(sqm));
      let perimMeters = 0;
      const segs: SegmentInfo[] = [];
      for (let i = 1; i < path.length; i++) {
        const segMeters = haversineMeters(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
        perimMeters += segMeters;
        const segFeet = segMeters * 3.28084;
        segs.push({
          fromIdx: i - 1, toIdx: i, meters: segMeters,
          displayFt: segFeet < 1000 ? `${Math.round(segFeet)} ft` : `${(segFeet / 5280).toFixed(2)} mi`,
          displayM: formatDistanceMetric(segMeters),
        });
      }
      if (path.length >= 3) {
        const closingMeters = haversineMeters(path[path.length - 1].lat, path[path.length - 1].lng, path[0].lat, path[0].lng);
        perimMeters += closingMeters;
      }
      setSegments(segs);
      const perimFmt = formatDistance(perimMeters);
      setPerimeterDisplay(`Perimeter: ${perimFmt.display} / ${formatDistanceMetric(perimMeters)}`);
      setAreaDisplay('');
      renderSegmentLabels(segs);
    }
  }, [renderSegmentLabels]);

  const removeOverlays = useCallback(() => {
    const m = mapRef.current;
    if (m) {
      removeSourceAndLayer(m, LINE_LAYER, LINE_SOURCE);
      removeSourceAndLayer(m, POLYGON_LAYER, POLYGON_SOURCE);
      removeSourceAndLayer(m, VERTEX_LAYER, VERTEX_SOURCE);
    }
    clearSegmentLabels();
  }, [clearSegmentLabels]);

  const removeListeners = useCallback(() => {
    const m = mapRef.current;
    if (clickHandlerRef.current) { m?.off('click', clickHandlerRef.current); clickHandlerRef.current = null; }
    if (dblClickHandlerRef.current) { m?.off('dblclick', dblClickHandlerRef.current); dblClickHandlerRef.current = null; }
  }, []);

  const addVertex = useCallback((lngLat: mapboxgl.LngLat) => {
    const point = { lat: lngLat.lat, lng: lngLat.lng };
    pathRef.current = [...pathRef.current, point];
    const mode = modeRef.current;
    const m = mapRef.current;
    if (!m) return;

    // Update shape layers
    removeSourceAndLayer(m, LINE_LAYER, LINE_SOURCE);
    removeSourceAndLayer(m, POLYGON_LAYER, POLYGON_SOURCE);

    if (mode === 'distance') {
      const coords = pathRef.current.map(p => [p.lng, p.lat] as [number, number]);
      const lineFeature: GeoJSON.Feature = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      };
      m.addSource(LINE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [lineFeature] } });
      m.addLayer({
        id: LINE_LAYER, type: 'line', source: LINE_SOURCE,
        paint: { 'line-color': '#d4a017', 'line-width': 3, 'line-opacity': 0.9 },
      });
    } else if (mode === 'area' && pathRef.current.length >= 3) {
      const coords = [...pathRef.current.map(p => [p.lng, p.lat] as [number, number]), [pathRef.current[0].lng, pathRef.current[0].lat]];
      const polyFeature: GeoJSON.Feature = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] },
      };
      m.addSource(POLYGON_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [polyFeature] } });
      m.addLayer({
        id: POLYGON_LAYER, type: 'fill', source: POLYGON_SOURCE,
        paint: { 'fill-color': '#d4a017', 'fill-opacity': 0.15, 'fill-outline-color': '#d4a017' },
      });
    }

    // Update vertex layer
    removeSourceAndLayer(m, VERTEX_LAYER, VERTEX_SOURCE);
    const vertexFeatures: GeoJSON.Feature[] = pathRef.current.map(p => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    }));
    m.addSource(VERTEX_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: vertexFeatures } });
    m.addLayer({
      id: VERTEX_LAYER, type: 'circle', source: VERTEX_SOURCE,
      paint: { 'circle-color': '#d4a017', 'circle-radius': 5, 'circle-stroke-color': '#050505', 'circle-stroke-width': 2 },
    });

    updateMeasurement();
  }, [updateMeasurement]);

  const finishMeasurement = useCallback(() => {
    removeListeners();
    setMeasuring(false);
  }, [removeListeners]);

  const undoLastPoint = useCallback(() => {
    if (pathRef.current.length === 0) return;
    pathRef.current = pathRef.current.slice(0, -1);
    const m = mapRef.current;
    if (m) {
      removeSourceAndLayer(m, LINE_LAYER, LINE_SOURCE);
      removeSourceAndLayer(m, POLYGON_LAYER, POLYGON_SOURCE);
      removeSourceAndLayer(m, VERTEX_LAYER, VERTEX_SOURCE);
    }
    if (pathRef.current.length > 0 && m) addVertex(new mapboxgl.LngLat(pathRef.current[pathRef.current.length - 1].lng, pathRef.current[pathRef.current.length - 1].lat));
    updateMeasurement();
    if (pathRef.current.length === 0) {
      setMeasureDisplay('');
      setMeasureDisplayMetric('');
      setSegments([]);
      setPerimeterDisplay('');
      setAreaDisplay('');
      clearSegmentLabels();
    }
  }, [updateMeasurement, clearSegmentLabels, addVertex]);

  const clearMeasurement = useCallback(() => {
    removeListeners();
    removeOverlays();
    pathRef.current = [];
    modeRef.current = null;
    mapRef.current = null;
    setMeasuring(false);
    setMeasureMode(null);
    setMeasureValue(0);
    setMeasureUnit('');
    setMeasureDisplay('');
    setMeasureDisplayMetric('');
    setSegments([]);
    setPerimeterDisplay('');
    setAreaDisplay('');
    setPointCount(0);
  }, [removeListeners, removeOverlays]);

  const startMeasure = useCallback((m: mapboxgl.Map, mode: MeasureMode) => {
    removeListeners();
    removeOverlays();
    pathRef.current = [];
    mapRef.current = m;
    modeRef.current = mode;
    setMeasureMode(mode);
    setMeasuring(true);
    setMeasureValue(0);
    setMeasureUnit(mode === 'distance' ? 'ft' : 'sq ft');
    setMeasureDisplay(mode === 'distance' ? '0 ft' : '0 sq ft');

    const onClick = (e: mapboxgl.MapMouseEvent) => addVertex(e.lngLat);
    const onDblClick = () => finishMeasurement();

    clickHandlerRef.current = onClick;
    dblClickHandlerRef.current = onDblClick;
    m.on('click', onClick);
    m.on('dblclick', onDblClick);
  }, [addVertex, finishMeasurement, removeListeners, removeOverlays]);

  useEffect(() => {
    return () => {
      removeListeners();
      removeOverlays();
    };
  }, [removeListeners, removeOverlays]);

  return {
    measuring, measureMode, measureValue, measureUnit, measureDisplay, measureDisplayMetric,
    segments, perimeterDisplay, areaDisplay, pointCount,
    startMeasure, finishMeasurement, clearMeasurement, undoLastPoint,
  };
}