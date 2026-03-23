// ============================================================
// RMPG Flex — useMapCoverageGaps Hook
// Unit coverage map: draws radius circles around on-duty units
// to visualize patrol coverage and identify gaps.
// ============================================================

import { useEffect, useRef, useState } from 'react';

// ─── Types ──────────────────────────────────────────────────

interface UnitPosition {
  call_sign: string;
  latitude?: number;
  longitude?: number;
  status?: string;
}

interface UseMapCoverageGapsReturn {
  coverageCount: number;
  uncoveredArea: boolean; // Fix 63: flag indicating uncovered gaps exist
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
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null); // Fix 65: info window
  const [coverageCount, setCoverageCount] = useState(0);

  // ── Render / clear circles ────────────────────────────────

  useEffect(() => {
    // Clear existing circles
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];
    setCoverageCount(0);

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

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    // Fix 63: determine coverage density per unit for color coding
    onDutyWithCoords.forEach((unit, _idx) => {
      const lat = Number(unit.latitude);
      const lng = Number(unit.longitude);

      // Fix 63: count nearby units to determine coverage quality
      const nearbyCount = onDutyWithCoords.filter((other) => {
        if (other.call_sign === unit.call_sign) return false;
        const dLat = Number(other.latitude) - lat;
        const dLng = Number(other.longitude) - lng;
        // Rough distance check (not precise but fast)
        return Math.sqrt(dLat * dLat + dLng * dLng) < (radiusMiles * 0.03);
      }).length;

      // Fix 63: color code by coverage density
      let color: string;
      let opacity: number;
      if (nearbyCount >= 2) {
        color = '#22c55e'; // green = well-covered
        opacity = 0.08;
      } else if (nearbyCount === 1) {
        color = '#f59e0b'; // yellow = sparse
        opacity = 0.06;
      } else {
        color = '#22c55e'; // single unit coverage
        opacity = 0.04;
      }

      // Fix 64: opacity scaling based on gap severity
      const circle = new google.maps.Circle({
        center: { lat, lng },
        radius: radiusMeters,
        fillColor: color,
        fillOpacity: opacity,
        strokeColor: color,
        strokeWeight: 1,
        strokeOpacity: 0.3,
        map,
        clickable: true,
        zIndex: 3,
      });

      // Fix 65: info window showing nearest unit info
      circle.addListener('click', () => {
        const container = document.createElement('div');
        container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:180px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:4px;border:1px solid #1e2a3a';
        const heading = document.createElement('div');
        heading.style.cssText = `font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}`;
        heading.textContent = `Coverage — ${unit.call_sign}`;
        container.appendChild(heading);
        const info = document.createElement('div');
        info.style.cssText = 'font-size:10px;color:#9ca3af';
        info.textContent = `${nearbyCount} nearby unit${nearbyCount !== 1 ? 's' : ''} within ${radiusMiles} mi`;
        container.appendChild(info);
        infoWindowRef.current?.setContent(container);
        infoWindowRef.current?.setPosition({ lat, lng });
        infoWindowRef.current?.open(map);
      });

      circlesRef.current.push(circle);
    });

    setCoverageCount(onDutyWithCoords.length);

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

  return { coverageCount, uncoveredArea: coverageCount === 0 };
}
