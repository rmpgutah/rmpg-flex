// ============================================================
// RMPG Flex — useMapDragDispatch Hook
// Drag a unit marker onto a call marker to dispatch.
// When enabled, unit markers become draggable; on dragend,
// the nearest call marker within 50px is identified and
// the onDispatch callback is invoked.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────

interface CallMarkerEntry {
  marker: google.maps.marker.AdvancedMarkerElement;
  callId: string;
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapDragDispatch(
  map: google.maps.Map | null,
  enabled: boolean,
  unitMarkers: Map<string, google.maps.marker.AdvancedMarkerElement>,
  callMarkers: Map<string, CallMarkerEntry>,
  onDispatch: (unitId: string, callId: string) => Promise<void>,
): { dispatching: boolean } {
  const [dispatching, setDispatching] = useState(false);
  const mountedRef = useRef(true);

  // Store original positions to snap back after drag
  const originalPositions = useRef<Map<string, google.maps.LatLngLiteral>>(new Map());
  const listenersRef = useRef<Map<string, google.maps.MapsEventListener>>(new Map());

  // ── Get pixel position from LatLng ──────────────────────

  const latLngToPixel = useCallback((latLng: google.maps.LatLng): { x: number; y: number } | null => {
    if (!map) return null;
    const projection = map.getProjection();
    if (!projection) return null;

    const zoom = map.getZoom();
    if (zoom == null) return null;

    const scale = Math.pow(2, zoom);
    const worldPoint = projection.fromLatLngToPoint(latLng);
    if (!worldPoint) return null;

    // Get the map's top-left corner in world coordinates
    const bounds = map.getBounds();
    if (!bounds) return null;

    const nw = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const topLeft = projection.fromLatLngToPoint(
      new google.maps.LatLng(nw.lat(), sw.lng())
    );
    if (!topLeft) return null;

    return {
      x: (worldPoint.x - topLeft.x) * scale,
      y: (worldPoint.y - topLeft.y) * scale,
    };
  }, [map]);

  // ── Find nearest call marker within threshold ───────────

  const findNearestCall = useCallback((dragPos: google.maps.LatLng): { callId: string; distance: number } | null => {
    const dragPx = latLngToPixel(dragPos);
    if (!dragPx) return null;

    let nearest: { callId: string; distance: number } | null = null;
    const THRESHOLD_PX = 50;

    callMarkers.forEach((entry) => {
      const pos = entry.marker.position;
      if (!pos) return;

      const lat = typeof pos.lat === 'function' ? (pos as google.maps.LatLng).lat() : (pos as google.maps.LatLngLiteral).lat;
      const lng = typeof pos.lng === 'function' ? (pos as google.maps.LatLng).lng() : (pos as google.maps.LatLngLiteral).lng;

      const callPx = latLngToPixel(new google.maps.LatLng(lat, lng));
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

  // ── Enable/disable dragging ─────────────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    // Clean up previous listeners
    listenersRef.current.forEach((listener) => {
      google.maps.event.removeListener(listener);
    });
    listenersRef.current.clear();
    originalPositions.current.clear();

    if (!enabled) {
      // Disable dragging on all unit markers
      unitMarkers.forEach((marker) => {
        marker.gmpDraggable = false;
      });
      return;
    }

    // Enable dragging and set up listeners
    unitMarkers.forEach((marker, unitId) => {
      marker.gmpDraggable = true;

      // Store original position
      const pos = marker.position;
      if (pos) {
        const lat = typeof pos.lat === 'function' ? (pos as google.maps.LatLng).lat() : (pos as google.maps.LatLngLiteral).lat;
        const lng = typeof pos.lng === 'function' ? (pos as google.maps.LatLng).lng() : (pos as google.maps.LatLngLiteral).lng;
        originalPositions.current.set(unitId, { lat, lng });
      }

      // Add drag glow class to marker content
      const content = marker.content as HTMLElement | null;
      if (content && content.style) {
        const origTransition = content.style.transition;
        const origFilter = content.style.filter;

        // On dragstart: add glow
        const dragStartListener = marker.addListener('dragstart', () => {
          if (content && content.style) {
            content.style.transition = 'filter 0.2s ease';
            content.style.filter = 'drop-shadow(0 0 8px #d4a017) drop-shadow(0 0 16px #d4a017)';
          }
        });

        // On dragend: check proximity, snap back, dispatch if match
        const dragEndListener = marker.addListener('dragend', async (e: google.maps.MapMouseEvent) => {
          // Remove glow
          if (content && content.style) {
            content.style.filter = origFilter || '';
            content.style.transition = origTransition || '';
          }

          // Snap marker back to original position
          const origPos = originalPositions.current.get(unitId);
          if (origPos) {
            marker.position = origPos;
          }

          if (!e.latLng) return;

          // Check if dropped near a call marker
          const nearest = findNearestCall(e.latLng);
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

        listenersRef.current.set(`${unitId}_dragstart`, dragStartListener);
        listenersRef.current.set(`${unitId}_dragend`, dragEndListener);
      }
    });

    return () => {
      listenersRef.current.forEach((listener) => {
        google.maps.event.removeListener(listener);
      });
      listenersRef.current.clear();

      // Disable dragging
      unitMarkers.forEach((marker) => {
        marker.gmpDraggable = false;
      });
    };
  }, [map, enabled, unitMarkers, callMarkers, findNearestCall, onDispatch]);

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      listenersRef.current.forEach((listener) => {
        if (window.google?.maps) {
          google.maps.event.removeListener(listener);
        }
      });
      listenersRef.current.clear();
    };
  }, []);

  return { dispatching };
}
