// ============================================================
// RMPG Flex — useMapResponseRadius Hook
// Client-side response time radius rings showing estimated
// travel distance at 30mph for 2, 5, and 10 minute intervals.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────

interface UseMapResponseRadiusReturn {
  showRadiusAt: (lat: number, lng: number) => void;
  clearRadius: () => void;
  activePoint: { lat: number; lng: number } | null;
  cursorRingsEnabled: boolean;
  setCursorRingsEnabled: (v: boolean) => void;
}

// ─── Ring definitions ───────────────────────────────────────
// 30 mph average response speed = ~804.67 m/min

const RINGS = [
  { minutes: 2,  radiusMeters: 1609,  fillColor: '#22c55e', strokeColor: '#22c55e', fillOpacity: 0.08, label: '2 min' },
  { minutes: 5,  radiusMeters: 4023,  fillColor: '#f59e0b', strokeColor: '#f59e0b', fillOpacity: 0.06, label: '5 min' },
  { minutes: 10, radiusMeters: 8047,  fillColor: '#dc2626', strokeColor: '#dc2626', fillOpacity: 0.04, label: '10 min' },
];

// Cursor distance rings — concentric circles following mouse
const CURSOR_RINGS = [
  { radiusMeters: 100,  strokeColor: '#22c55e', fillOpacity: 0.05, label: '100m' },
  { radiusMeters: 250,  strokeColor: '#888888', fillOpacity: 0.04, label: '250m' },
  { radiusMeters: 500,  strokeColor: '#f59e0b', fillOpacity: 0.03, label: '500m' },
  { radiusMeters: 1000, strokeColor: '#ef4444', fillOpacity: 0.02, label: '1km' },
];

// ─── Hook ───────────────────────────────────────────────────

export function useMapResponseRadius(
  map: google.maps.Map | null,
  enabled: boolean,
): UseMapResponseRadiusReturn {
  const [activePoint, setActivePoint] = useState<{ lat: number; lng: number } | null>(null);
  const [cursorRingsEnabled, setCursorRingsEnabled] = useState(false);

  const circlesRef = useRef<google.maps.Circle[]>([]);
  const cursorCirclesRef = useRef<google.maps.Circle[]>([]);
  const mouseMoveListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Clear all circles ─────────────────────────────────────

  const clearRadius = useCallback(() => {
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];
    setActivePoint(null);
  }, []);

  // ── Show radius rings at a point ──────────────────────────

  const showRadiusAt = useCallback((lat: number, lng: number) => {
    if (!map || !window.google?.maps || !enabled) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    // Clear existing rings first
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];

    const center = { lat, lng };
    setActivePoint(center);

    // Draw rings from outermost to innermost so inner rings render on top
    const sortedRings = [...RINGS].reverse();

    sortedRings.forEach((ring) => {
      const circle = new google.maps.Circle({
        center,
        radius: ring.radiusMeters,
        fillColor: ring.fillColor,
        fillOpacity: ring.fillOpacity,
        strokeColor: ring.strokeColor,
        strokeWeight: 2,
        strokeOpacity: 0.5,
        map,
        clickable: false,
        zIndex: 5,
      });

      circlesRef.current.push(circle);
    });
  }, [map, enabled]);

  // ── Clear when disabled ───────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      clearRadius();
    }
  }, [enabled, clearRadius]);

  // ── Cursor distance rings — follow mouse ──────────────────

  useEffect(() => {
    if (!map || !window.google?.maps || !enabled || !cursorRingsEnabled) {
      // Cleanup cursor rings
      cursorCirclesRef.current.forEach((c) => c.setMap(null));
      cursorCirclesRef.current = [];
      if (mouseMoveListenerRef.current) {
        google.maps.event.removeListener(mouseMoveListenerRef.current);
        mouseMoveListenerRef.current = null;
      }
      return;
    }

    // Create cursor ring circles (hidden until first mousemove)
    const circles = CURSOR_RINGS.map((ring) => new google.maps.Circle({
      center: { lat: 0, lng: 0 },
      radius: ring.radiusMeters,
      fillColor: ring.strokeColor,
      fillOpacity: ring.fillOpacity,
      strokeColor: ring.strokeColor,
      strokeWeight: 1,
      strokeOpacity: 0.4,
      map: null, // start hidden
      clickable: false,
      zIndex: 3,
    }));
    cursorCirclesRef.current = circles;

    // Throttled mousemove handler (100ms)
    mouseMoveListenerRef.current = map.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
      if (throttleTimerRef.current) return;

      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
      }, 100);

      if (!e.latLng) return;
      const center = { lat: e.latLng.lat(), lng: e.latLng.lng() };

      circles.forEach((circle) => {
        circle.setCenter(center);
        if (!circle.getMap()) circle.setMap(map);
      });
    });

    // Hide rings when mouse leaves map
    const mouseOutListener = map.addListener('mouseout', () => {
      circles.forEach((c) => c.setMap(null));
    });

    return () => {
      circles.forEach((c) => c.setMap(null));
      cursorCirclesRef.current = [];
      if (mouseMoveListenerRef.current) {
        google.maps.event.removeListener(mouseMoveListenerRef.current);
        mouseMoveListenerRef.current = null;
      }
      google.maps.event.removeListener(mouseOutListener);
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
    };
  }, [map, enabled, cursorRingsEnabled]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      circlesRef.current.forEach((c) => c.setMap(null));
      circlesRef.current = [];
      cursorCirclesRef.current.forEach((c) => c.setMap(null));
      cursorCirclesRef.current = [];
      if (mouseMoveListenerRef.current) {
        google.maps.event.removeListener(mouseMoveListenerRef.current);
      }
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);

  return { showRadiusAt, clearRadius, activePoint, cursorRingsEnabled, setCursorRingsEnabled };
}
