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
}

// ─── Ring definitions ───────────────────────────────────────
// 30 mph = ~48.28 km/h = ~804.67 m/min

const RINGS = [
  { minutes: 2,  radiusMeters: 1609,  fillColor: '#22c55e', strokeColor: '#22c55e', fillOpacity: 0.08, label: '2 min' },
  { minutes: 5,  radiusMeters: 4023,  fillColor: '#f59e0b', strokeColor: '#f59e0b', fillOpacity: 0.06, label: '5 min' },
  { minutes: 10, radiusMeters: 8047,  fillColor: '#dc2626', strokeColor: '#dc2626', fillOpacity: 0.04, label: '10 min' },
];

// ─── Hook ───────────────────────────────────────────────────

export function useMapResponseRadius(
  map: google.maps.Map | null,
  enabled: boolean,
): UseMapResponseRadiusReturn {
  const [activePoint, setActivePoint] = useState<{ lat: number; lng: number } | null>(null);

  const circlesRef = useRef<google.maps.Circle[]>([]);

  // ── Clear all circles ─────────────────────────────────────

  const clearRadius = useCallback(() => {
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];
    setActivePoint(null);
  }, []);

  // ── Show radius rings at a point ──────────────────────────

  const showRadiusAt = useCallback((lat: number, lng: number) => {
    if (!map || !window.google?.maps || !enabled) return;

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

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      circlesRef.current.forEach((c) => c.setMap(null));
      circlesRef.current = [];
    };
  }, []);

  return { showRadiusAt, clearRadius, activePoint };
}
