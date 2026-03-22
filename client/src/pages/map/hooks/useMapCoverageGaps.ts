// ============================================================
// RMPG Flex — useMapCoverageGaps Hook
// Unit coverage map: draws radius circles around on-duty units
// to visualize patrol coverage and identify gaps.
// ============================================================

import { useEffect, useRef } from 'react';

// ─── Types ──────────────────────────────────────────────────

interface UnitPosition {
  call_sign: string;
  latitude?: number;
  longitude?: number;
  status?: string;
}

interface UseMapCoverageGapsReturn {
  coverageCount: number;
}

// ─── On-duty statuses ───────────────────────────────────────

const ON_DUTY_STATUSES = new Set([
  'available', 'dispatched', 'enroute', 'onscene', 'busy',
]);

// ─── Meters per mile ────────────────────────────────────────

const METERS_PER_MILE = 1609.34;

// ─── Hook ───────────────────────────────────────────────────

export function useMapCoverageGaps(
  map: google.maps.Map | null,
  units: UnitPosition[],
  enabled: boolean,
  radiusMiles: number,
): UseMapCoverageGapsReturn {
  const circlesRef = useRef<google.maps.Circle[]>([]);
  const coverageCountRef = useRef(0);

  // ── Render / clear circles ────────────────────────────────

  useEffect(() => {
    // Clear existing circles
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];
    coverageCountRef.current = 0;

    if (!map || !window.google?.maps || !enabled) return;

    const radiusMeters = radiusMiles * METERS_PER_MILE;

    const onDutyWithCoords = units.filter(
      (u) =>
        u.latitude != null &&
        u.longitude != null &&
        !isNaN(Number(u.latitude)) &&
        !isNaN(Number(u.longitude)) &&
        ON_DUTY_STATUSES.has(u.status || ''),
    );

    onDutyWithCoords.forEach((unit) => {
      const circle = new google.maps.Circle({
        center: { lat: Number(unit.latitude), lng: Number(unit.longitude) },
        radius: radiusMeters,
        fillColor: '#22c55e',
        fillOpacity: 0.06,
        strokeColor: '#22c55e',
        strokeWeight: 1,
        strokeOpacity: 0.3,
        map,
        clickable: false,
        zIndex: 3,
      });
      circlesRef.current.push(circle);
    });

    coverageCountRef.current = onDutyWithCoords.length;

    return () => {
      circlesRef.current.forEach((c) => c.setMap(null));
      circlesRef.current = [];
    };
  }, [map, units, enabled, radiusMiles]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      circlesRef.current.forEach((c) => c.setMap(null));
      circlesRef.current = [];
    };
  }, []);

  return { coverageCount: coverageCountRef.current };
}
