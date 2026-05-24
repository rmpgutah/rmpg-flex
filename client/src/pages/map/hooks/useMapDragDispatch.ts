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

  const originalPositions = useRef<Map<string, mapboxgl.LngLat>>(new Map());
  const dragStateRef = useRef<Map<string, boolean>>(new Map());

  const findNearestCall = useCallback((dragPos: mapboxgl.LngLat): { callId: string; distance: number } | null => {
    if (!map) return null;
    const dragPoint = map.project(dragPos);
    let nearest: { callId: string; distance: number } | null = null;
    const THRESHOLD_PX = 50;

    callMarkers.forEach((entry) => {
      const pos = entry.marker.getLngLat();
      if (!pos) return;
      const callPoint = map.project(pos);
      const dx = dragPoint.x - callPoint.x;
      const dy = dragPoint.y - callPoint.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= THRESHOLD_PX && (!nearest || dist < nearest.distance)) {
        nearest = { callId: entry.callId, distance: dist };
      }
    });

    return nearest;
  }, [callMarkers, map]);

  useEffect(() => {
    if (!map) return;

    dragStateRef.current.clear();
    originalPositions.current.clear();

    if (!enabled) {
      unitMarkers.forEach((marker) => {
        marker.setDraggable(false);
      });
      return;
    }

    unitMarkers.forEach((marker, unitId) => {
      const pos = marker.getLngLat();
      if (pos) originalPositions.current.set(unitId, pos);

      // Make marker draggable
      if (marker.setDraggable) marker.setDraggable(true);
      else (marker as any)._draggable = true;

      const el = marker.getElement();
      const origTransition = el.style.transition;
      const origFilter = el.style.filter;

      const onDragStart = () => {
        dragStateRef.current.set(unitId, true);
        el.style.transition = 'filter 0.2s ease';
        el.style.filter = 'drop-shadow(0 0 8px #d4a017) drop-shadow(0 0 16px #d4a017)';
      };

      const onDragEnd = async () => {
        dragStateRef.current.set(unitId, false);
        el.style.filter = origFilter || '';
        el.style.transition = origTransition || '';

        const origPos = originalPositions.current.get(unitId);
        if (origPos) marker.setLngLat(origPos);

        const currentPos = marker.getLngLat();
        if (!currentPos) return;

        const nearest = findNearestCall(currentPos);
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
      };

      el.addEventListener('mousedown', onDragStart);
      el.addEventListener('mouseup', onDragEnd);
      el.addEventListener('touchstart', onDragStart);
      el.addEventListener('touchend', onDragEnd);

      // Store cleanup
      const _cleanup = () => {
        el.removeEventListener('mousedown', onDragStart);
        el.removeEventListener('mouseup', onDragEnd);
        el.removeEventListener('touchstart', onDragStart);
        el.removeEventListener('touchend', onDragEnd);
      };
      (marker as any)._dragCleanup = _cleanup;
    });

    return () => {
      unitMarkers.forEach((marker) => {
        if (marker.setDraggable) marker.setDraggable(false);
        else (marker as any)._draggable = false;
        if ((marker as any)._dragCleanup) {
          (marker as any)._dragCleanup();
          delete (marker as any)._dragCleanup;
        }
      });
    };
  }, [map, enabled, unitMarkers, callMarkers, findNearestCall, onDispatch]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  return { dispatching };
}