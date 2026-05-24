import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';

interface CallMarkerEntry {
  marker: mapboxgl.Marker;
  callId: string;
}

export function useMapDragDispatch(
  map: mapboxgl.Map | null,
  enabled: boolean,
  unitMarkers: Map<string, mapboxgl.Marker>,
  callMarkers: Map<string, CallMarkerEntry>,
  onDispatch: (unitId: string, callId: string) => Promise<void>,
): { dispatching: boolean } {
  const [dispatching, setDispatching] = useState(false);
  const mountedRef = useRef(true);

  const originalPositions = useRef<Map<string, [number, number]>>(new Map());

  const latLngToPixel = useCallback((lng: number, lat: number): { x: number; y: number } | null => {
    if (!map) return null;
    const point = map.project([lng, lat]);
    return { x: point.x, y: point.y };
  }, [map]);

  const findNearestCall = useCallback((dragLng: number, dragLat: number): { callId: string; distance: number } | null => {
    const dragPx = latLngToPixel(dragLng, dragLat);
    if (!dragPx) return null;

    let nearest: { callId: string; distance: number } | null = null;
    const THRESHOLD_PX = 50;

    callMarkers.forEach((entry) => {
      const pos = entry.marker.getLngLat();
      if (!pos) return;

      const callPx = latLngToPixel(pos.lng, pos.lat);
      if (!callPx) return;

      const dx = dragPx.x - callPx.x;
      const dy = dragPx.y - callPx.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= THRESHOLD_PX && (!nearest || dist < nearest.distance)) {
        nearest = { callId: entry.callId, distance: dist };
      }
    });

    return nearest;
  }, [callMarkers, latLngToPixel]);

  useEffect(() => {
    if (!map) return;

    originalPositions.current.clear();

    if (!enabled) {
      unitMarkers.forEach((marker) => {
        marker.setDraggable(false);
      });
      return;
    }

    unitMarkers.forEach((marker, unitId) => {
      marker.setDraggable(true);

      const pos = marker.getLngLat();
      if (pos) {
        originalPositions.current.set(unitId, [pos.lng, pos.lat]);
      }

      const content = marker.getElement();
      if (content) {
        const origTransition = content.style.transition;
        const origFilter = content.style.filter;

        marker.on('dragstart', () => {
          if (content && content.style) {
            content.style.transition = 'filter 0.2s ease';
            content.style.filter = 'drop-shadow(0 0 8px #d4a017) drop-shadow(0 0 16px #d4a017)';
          }
        });

        marker.on('dragend', async () => {
          if (content && content.style) {
            content.style.filter = origFilter || '';
            content.style.transition = origTransition || '';
          }

          const origPos = originalPositions.current.get(unitId);
          if (origPos) {
            marker.setLngLat(origPos);
          }

          const pos = marker.getLngLat();
          if (!pos) return;

          const nearest = findNearestCall(pos.lng, pos.lat);
          if (nearest) {
            setDispatching(true);
            try {
              await onDispatch(unitId, nearest.callId);
            } catch (err) {
              console.warn('[useMapDragDispatch] Dispatch failed:', err);
            } finally {
              if (mountedRef.current) setDispatching(false);
            }
          }
        });
      }
    });

    return () => {
      unitMarkers.forEach((marker) => {
        marker.setDraggable(false);
      });
    };
  }, [map, enabled, unitMarkers, callMarkers, findNearestCall, onDispatch]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { dispatching };
}
