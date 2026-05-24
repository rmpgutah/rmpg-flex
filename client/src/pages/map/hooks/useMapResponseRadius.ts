import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';

interface UseMapResponseRadiusReturn {
  showRadiusAt: (lat: number, lng: number) => void;
  clearRadius: () => void;
  activePoint: { lat: number; lng: number } | null;
  cursorRingsEnabled: boolean;
  setCursorRingsEnabled: (v: boolean) => void;
}

const RINGS = [
  { minutes: 2, radiusMeters: 1609, color: '#22c55e', fillOpacity: 0.08, label: '2 min' },
  { minutes: 5, radiusMeters: 4023, color: '#f59e0b', fillOpacity: 0.06, label: '5 min' },
  { minutes: 10, radiusMeters: 8047, color: '#dc2626', fillOpacity: 0.04, label: '10 min' },
];

const CURSOR_RINGS = [
  { radiusMeters: 100, color: '#22c55e', fillOpacity: 0.05, label: '100m' },
  { radiusMeters: 250, color: '#888888', fillOpacity: 0.04, label: '250m' },
  { radiusMeters: 500, color: '#f59e0b', fillOpacity: 0.03, label: '500m' },
  { radiusMeters: 1000, color: '#ef4444', fillOpacity: 0.02, label: '1km' },
];

const RINGS_SOURCE = 'response-radius-source';
const RINGS_LAYER = 'response-radius-layer';

function circleToPolygon(center: [number, number], radiusM: number, segments = 32): [number, number][] {
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

function removeLayer(map: mapboxgl.Map) {
  try {
    if (map.getLayer(RINGS_LAYER)) map.removeLayer(RINGS_LAYER);
    if (map.getSource(RINGS_SOURCE)) map.removeSource(RINGS_SOURCE);
  } catch { /* ignore */ }
}

export function useMapResponseRadius(map: mapboxgl.Map | null, enabled: boolean): UseMapResponseRadiusReturn {
  const [activePoint, setActivePoint] = useState<{ lat: number; lng: number } | null>(null);
  const [cursorRingsEnabled, setCursorRingsEnabled] = useState(false);
  const cursorCirclesRef = useRef<mapboxgl.Marker[]>([]);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRadius = useCallback(() => {
    if (map) removeLayer(map);
    setActivePoint(null);
  }, [map]);

  const showRadiusAt = useCallback((lat: number, lng: number) => {
    if (!map || !enabled) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    removeLayer(map);
    setActivePoint({ lat, lng });

    const features: GeoJSON.Feature[] = [...RINGS].reverse().map((ring) => ({
      type: 'Feature',
      properties: { color: ring.color, opacity: ring.fillOpacity },
      geometry: { type: 'Polygon', coordinates: [circleToPolygon([lng, lat], ring.radiusMeters)] },
    }));

    map.addSource(RINGS_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: RINGS_LAYER, type: 'fill', source: RINGS_SOURCE,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'], 'fill-outline-color': ['get', 'color'] },
    });
  }, [map, enabled]);

  useEffect(() => {
    if (!enabled) clearRadius();
  }, [enabled, clearRadius]);

  // Cursor rings
  useEffect(() => {
    if (!map || !enabled || !cursorRingsEnabled) {
      cursorCirclesRef.current.forEach((m) => m.remove());
      cursorCirclesRef.current = [];
      if (throttleTimerRef.current) { clearTimeout(throttleTimerRef.current); throttleTimerRef.current = null; }
      return;
    }

    // Create cursor ring markers (DOM-based circles)
    const markers = CURSOR_RINGS.map((ring) => {
      const el = document.createElement('div');
      const r = ring.radiusMeters;
      const size = Math.min(r / 5, 200);
      el.style.cssText = `
        width: ${size * 2}px; height: ${size * 2}px;
        border-radius: 50%;
        border: 1px solid ${ring.color};
        background: transparent;
        pointer-events: none;
        opacity: 0.4;
      `;
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([0, 0]);
      return marker;
    });
    cursorCirclesRef.current = markers;

    const onMouseMove = (e: mapboxgl.MapMouseEvent) => {
      if (throttleTimerRef.current) return;
      throttleTimerRef.current = setTimeout(() => { throttleTimerRef.current = null; }, 100);
      markers.forEach((m) => m.setLngLat(e.lngLat));
      markers.forEach((m) => { if (!m.getElement().parentNode) m.addTo(map); });
    };

    const onMouseOut = () => {
      markers.forEach((m) => m.remove());
    };

    map.on('mousemove', onMouseMove);
    map.on('mouseout', onMouseOut);

    return () => {
      map.off('mousemove', onMouseMove);
      map.off('mouseout', onMouseOut);
      markers.forEach((m) => m.remove());
      cursorCirclesRef.current = [];
      if (throttleTimerRef.current) { clearTimeout(throttleTimerRef.current); throttleTimerRef.current = null; }
    };
  }, [map, enabled, cursorRingsEnabled]);

  useEffect(() => {
    return () => {
      if (map) removeLayer(map);
      cursorCirclesRef.current.forEach((m) => m.remove());
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  }, [map]);

  return { showRadiusAt, clearRadius, activePoint, cursorRingsEnabled, setCursorRingsEnabled };
}