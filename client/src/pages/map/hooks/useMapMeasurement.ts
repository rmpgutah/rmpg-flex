// ============================================================
// RMPG Flex — useMapMeasurement Hook
// Provides distance and area measurement on Google Maps.
// Click to add vertices, double-click to finish.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';

// ─── Types ──────────────────────────────────────────────────

export type MeasureMode = 'distance' | 'area';

export interface MeasurementState {
  measuring: boolean;
  measureMode: MeasureMode | null;
  measureValue: number;
  measureUnit: string;
  measureDisplay: string;
  startMeasure: (map: google.maps.Map, mode: MeasureMode) => void;
  finishMeasurement: () => void;
  clearMeasurement: () => void;
}

// ─── Haversine distance (meters) ────────────────────────────

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return 0;
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Spherical area via Shoelace on lat/lng (sq meters) ─────
// Approximation using spherical excess formula.

function computeSphericalArea(path: google.maps.LatLngLiteral[]): number {
  // Filter out non-finite coordinates
  const validPath = path.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (validPath.length < 3) return 0;
  // Try the Google geometry library first
  if (
    typeof google !== 'undefined' &&
    google.maps?.geometry?.spherical?.computeArea
  ) {
    const latLngs = validPath.map((p) => new google.maps.LatLng(p.lat, p.lng));
    return google.maps.geometry.spherical.computeArea(latLngs);
  }

  // Fallback: spherical excess formula
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

// ─── Display formatting ─────────────────────────────────────

function formatDistance(meters: number): { value: number; unit: string; display: string } {
  const feet = meters * 3.28084;
  if (feet < 1000) {
    return { value: feet, unit: 'ft', display: `${Math.round(feet).toLocaleString()} ft` };
  }
  const miles = feet / 5280;
  return { value: miles, unit: 'mi', display: `${miles.toFixed(2)} mi` };
}

function formatArea(sqMeters: number): { value: number; unit: string; display: string } {
  const sqFeet = sqMeters * 10.7639;
  if (sqFeet < 43560) {
    return { value: sqFeet, unit: 'sq ft', display: `${Math.round(sqFeet).toLocaleString()} sq ft` };
  }
  const acres = sqFeet / 43560;
  return { value: acres, unit: 'acres', display: `${acres.toFixed(2)} acres` };
}

// ─── Vertex marker style ────────────────────────────────────

const VERTEX_ICON = {
  path: 0, // google.maps.SymbolPath.CIRCLE
  scale: 5,
  fillColor: '#d4a017',
  fillOpacity: 1,
  strokeColor: '#0d1520',
  strokeWeight: 2,
};

const LINE_OPTIONS: google.maps.PolylineOptions = {
  strokeColor: '#d4a017',
  strokeWeight: 3,
  strokeOpacity: 0.9,
};

const POLYGON_OPTIONS: google.maps.PolygonOptions = {
  strokeColor: '#d4a017',
  strokeWeight: 3,
  strokeOpacity: 0.9,
  fillColor: '#d4a017',
  fillOpacity: 0.15,
};

// ─── Hook ───────────────────────────────────────────────────

export function useMapMeasurement(): MeasurementState {
  const [measuring, setMeasuring] = useState(false);
  const [measureMode, setMeasureMode] = useState<MeasureMode | null>(null);
  const [measureValue, setMeasureValue] = useState(0);
  const [measureUnit, setMeasureUnit] = useState('');
  const [measureDisplay, setMeasureDisplay] = useState('');

  const pathRef = useRef<google.maps.LatLngLiteral[]>([]);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const polygonRef = useRef<google.maps.Polygon | null>(null);
  const vertexMarkersRef = useRef<google.maps.Marker[]>([]);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const dblClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const modeRef = useRef<MeasureMode | null>(null);

  // ── Update measurement display ─────────────────────────

  const updateMeasurement = useCallback(() => {
    const path = pathRef.current;
    const mode = modeRef.current;

    if (mode === 'distance') {
      let totalMeters = 0;
      for (let i = 1; i < path.length; i++) {
        totalMeters += haversineMeters(
          path[i - 1].lat, path[i - 1].lng,
          path[i].lat, path[i].lng,
        );
      }
      const fmt = formatDistance(totalMeters);
      setMeasureValue(fmt.value);
      setMeasureUnit(fmt.unit);
      setMeasureDisplay(fmt.display);
    } else if (mode === 'area') {
      const sqm = computeSphericalArea(path);
      const fmt = formatArea(sqm);
      setMeasureValue(fmt.value);
      setMeasureUnit(fmt.unit);
      setMeasureDisplay(fmt.display);
    }
  }, []);

  // ── Add a vertex ───────────────────────────────────────

  const addVertex = useCallback((latLng: google.maps.LatLng) => {
    const point = { lat: latLng.lat(), lng: latLng.lng() };
    pathRef.current = [...pathRef.current, point];
    const mode = modeRef.current;

    // Add vertex marker
    if (mapRef.current) {
      const marker = new google.maps.Marker({
        position: point,
        map: mapRef.current,
        icon: VERTEX_ICON,
        clickable: false,
        zIndex: 9999,
      });
      vertexMarkersRef.current.push(marker);
    }

    // Update shape
    if (mode === 'distance') {
      if (!polylineRef.current && mapRef.current) {
        polylineRef.current = new google.maps.Polyline({
          ...LINE_OPTIONS,
          map: mapRef.current,
          path: pathRef.current,
          zIndex: 9998,
        });
      } else {
        polylineRef.current?.setPath(pathRef.current);
      }
    } else if (mode === 'area') {
      if (!polygonRef.current && mapRef.current) {
        polygonRef.current = new google.maps.Polygon({
          ...POLYGON_OPTIONS,
          map: mapRef.current,
          paths: pathRef.current,
          zIndex: 9998,
        });
      } else {
        polygonRef.current?.setPaths(pathRef.current);
      }
    }

    updateMeasurement();
  }, [updateMeasurement]);

  // ── Remove all overlays ────────────────────────────────

  const removeOverlays = useCallback(() => {
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }
    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
    for (const m of vertexMarkersRef.current) {
      m.setMap(null);
    }
    vertexMarkersRef.current = [];
  }, []);

  // ── Remove listeners ───────────────────────────────────

  const removeListeners = useCallback(() => {
    if (clickListenerRef.current) {
      google.maps.event.removeListener(clickListenerRef.current);
      clickListenerRef.current = null;
    }
    if (dblClickListenerRef.current) {
      google.maps.event.removeListener(dblClickListenerRef.current);
      dblClickListenerRef.current = null;
    }
  }, []);

  // ── Finish measurement (keep shape, stop adding points) ─

  const finishMeasurement = useCallback(() => {
    removeListeners();
    setMeasuring(false);
    // Restore map double-click zoom
    if (mapRef.current) {
      mapRef.current.setOptions({ disableDoubleClickZoom: false });
    }
  }, [removeListeners]);

  // ── Clear everything ───────────────────────────────────

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
  }, [removeListeners, removeOverlays]);

  // ── Start measurement ──────────────────────────────────

  const startMeasure = useCallback((map: google.maps.Map, mode: MeasureMode) => {
    // Reset any existing measurement
    removeListeners();
    removeOverlays();
    pathRef.current = [];

    mapRef.current = map;
    modeRef.current = mode;
    setMeasureMode(mode);
    setMeasuring(true);
    setMeasureValue(0);
    setMeasureUnit(mode === 'distance' ? 'ft' : 'sq ft');
    setMeasureDisplay(mode === 'distance' ? '0 ft' : '0 sq ft');

    // Disable double-click zoom while measuring
    map.setOptions({ disableDoubleClickZoom: true });

    // Click to add vertex
    clickListenerRef.current = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (e.latLng) addVertex(e.latLng);
    });

    // Double-click to finish
    dblClickListenerRef.current = map.addListener('dblclick', () => {
      finishMeasurement();
    });
  }, [addVertex, finishMeasurement, removeListeners, removeOverlays]);

  // ── Cleanup on unmount ─────────────────────────────────

  useEffect(() => {
    return () => {
      removeListeners();
      removeOverlays();
      if (mapRef.current) {
        mapRef.current.setOptions({ disableDoubleClickZoom: false });
      }
    };
  }, [removeListeners, removeOverlays]);

  return {
    measuring,
    measureMode,
    measureValue,
    measureUnit,
    measureDisplay,
    startMeasure,
    finishMeasurement,
    clearMeasurement,
  };
}
