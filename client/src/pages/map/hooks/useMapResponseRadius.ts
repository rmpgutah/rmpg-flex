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
  { minutes: 2, radiusMeters: 1609, fillColor: '#22c55e', strokeColor: '#22c55e', fillOpacity: 0.08, label: '2 min' },
  { minutes: 5, radiusMeters: 4023, fillColor: '#f59e0b', strokeColor: '#f59e0b', fillOpacity: 0.06, label: '5 min' },
  { minutes: 10, radiusMeters: 8047, fillColor: '#dc2626', strokeColor: '#dc2626', fillOpacity: 0.04, label: '10 min' },
];

const CURSOR_RINGS = [
  { radiusMeters: 100, strokeColor: '#22c55e', fillOpacity: 0.05, label: '100m' },
  { radiusMeters: 250, strokeColor: '#888888', fillOpacity: 0.04, label: '250m' },
  { radiusMeters: 500, strokeColor: '#f59e0b', fillOpacity: 0.03, label: '500m' },
  { radiusMeters: 1000, strokeColor: '#ef4444', fillOpacity: 0.02, label: '1km' },
];

export function useMapResponseRadius(
  map: mapboxgl.Map | null,
  enabled: boolean,
): UseMapResponseRadiusReturn {
  const [activePoint, setActivePoint] = useState<{ lat: number; lng: number } | null>(null);
  const [cursorRingsEnabled, setCursorRingsEnabled] = useState(false);

  const sourceId = 'response-radius';
  const cursorSourceId = 'cursor-rings';
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const mouseMoveHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRadius = useCallback(() => {
    if (!map) return;
    if (map.getLayer(sourceId)) map.removeLayer(sourceId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    setActivePoint(null);
  }, [map]);

  const showRadiusAt = useCallback((lat: number, lng: number) => {
    if (!map || !enabled) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    clearRadius();
    setActivePoint({ lat, lng });

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '200px', closeButton: true, closeOnClick: false });
    }

    const features = RINGS.map((ring) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] },
      properties: { radius: ring.radiusMeters, color: ring.fillColor, opacity: ring.fillOpacity, label: ring.label },
    }));

    map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });

    RINGS.forEach((ring, i) => {
      map.addLayer({
        id: `${sourceId}-${i}`,
        type: 'circle',
        source: sourceId,
        filter: ['==', ['get', 'label'], ring.label],
        paint: {
          'circle-color': ring.fillColor,
          'circle-radius': ring.radiusMeters,
          'circle-opacity': ring.fillOpacity,
          'circle-stroke-color': ring.strokeColor,
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.5,
        },
      });
    });
  }, [map, enabled, clearRadius]);

  useEffect(() => {
    if (!enabled) clearRadius();
  }, [enabled, clearRadius]);

  useEffect(() => {
    if (!map || !enabled || !cursorRingsEnabled) {
      if (map) {
        if (map.getLayer(cursorSourceId)) map.removeLayer(cursorSourceId);
        if (map.getSource(cursorSourceId)) map.removeSource(cursorSourceId);
      }
      if (mouseMoveHandlerRef.current) {
        map?.getCanvas()?.removeEventListener('mousemove', mouseMoveHandlerRef.current);
        mouseMoveHandlerRef.current = null;
      }
      return;
    }

    const features = CURSOR_RINGS.map((ring) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] },
      properties: { radius: ring.radiusMeters, color: ring.strokeColor, opacity: ring.fillOpacity, label: ring.label },
    }));

    map.addSource(cursorSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });

    CURSOR_RINGS.forEach((ring, i) => {
      if (map.getLayer(`${cursorSourceId}-${i}`)) map.removeLayer(`${cursorSourceId}-${i}`);
      map.addLayer({
        id: `${cursorSourceId}-${i}`,
        type: 'circle',
        source: cursorSourceId,
        filter: ['==', ['get', 'label'], ring.label],
        paint: {
          'circle-color': ring.strokeColor,
          'circle-radius': ring.radiusMeters,
          'circle-opacity': ring.fillOpacity,
          'circle-stroke-color': ring.strokeColor,
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.4,
        },
      });
    });

    const handler = (e: MouseEvent) => {
      if (throttleTimerRef.current) return;
      throttleTimerRef.current = setTimeout(() => { throttleTimerRef.current = null; }, 100);

      const rect = map.getCanvas().getBoundingClientRect();
      const point: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
      const lngLat = map.unproject(point);

      const source = map.getSource(cursorSourceId) as mapboxgl.GeoJSONSource | undefined;
      if (source) {
        const updatedFeatures = CURSOR_RINGS.map((ring) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [lngLat.lng, lngLat.lat] as [number, number] },
          properties: { radius: ring.radiusMeters, color: ring.strokeColor, opacity: ring.fillOpacity, label: ring.label },
        }));
        source.setData({ type: 'FeatureCollection', features: updatedFeatures });
      }
    };

    map.getCanvas().addEventListener('mousemove', handler);
    mouseMoveHandlerRef.current = handler;

    return () => {
      map.getCanvas().removeEventListener('mousemove', handler);
      mouseMoveHandlerRef.current = null;
      if (map.getLayer(cursorSourceId)) map.removeLayer(cursorSourceId);
      if (map.getSource(cursorSourceId)) map.removeSource(cursorSourceId);
      if (throttleTimerRef.current) { clearTimeout(throttleTimerRef.current); throttleTimerRef.current = null; }
    };
  }, [map, enabled, cursorRingsEnabled]);

  useEffect(() => {
    return () => {
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      if (mouseMoveHandlerRef.current && map) map.getCanvas().removeEventListener('mousemove', mouseMoveHandlerRef.current);
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  }, [map]);

  return { showRadiusAt, clearRadius, activePoint, cursorRingsEnabled, setCursorRingsEnabled };
}
