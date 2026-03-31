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

interface DeadZone {
  lat: number;
  lng: number;
  label: string;
}

interface RepositionSuggestion {
  fromCallSign: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

interface UseMapCoverageGapsReturn {
  coverageCount: number;
  uncoveredArea: boolean; // Fix 63: flag indicating uncovered gaps exist
  deadZones: DeadZone[];
  repositionSuggestions: RepositionSuggestion[];
}

// ─── On-duty statuses ───────────────────────────────────────

const ON_DUTY_STATUSES = new Set([
  'available', 'dispatched', 'enroute', 'onscene', 'busy',
]);

// ─── Meters per mile ────────────────────────────────────────

const METERS_PER_MILE = 1609.34;

// ─── Hook ───────────────────────────────────────────────────

// ── Haversine distance (meters) for coverage calculations ───
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Response time estimate: ~30 mph average patrol speed
const RESPONSE_SPEED_MPS = 13.4; // 30 mph in m/s
const FIVE_MINUTE_METERS = RESPONSE_SPEED_MPS * 300; // 5 min response radius

export function useMapCoverageGaps(
  map: google.maps.Map | null,
  units: UnitPosition[],
  enabled: boolean,
  radiusMiles: number,
): UseMapCoverageGapsReturn {
  const circlesRef = useRef<google.maps.Circle[]>([]);
  const deadZoneCirclesRef = useRef<google.maps.Circle[]>([]);
  const arrowPolylinesRef = useRef<google.maps.Polyline[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [coverageCount, setCoverageCount] = useState(0);
  const [deadZones, setDeadZones] = useState<DeadZone[]>([]);
  const [repositionSuggestions, setRepositionSuggestions] = useState<RepositionSuggestion[]>([]);

  // ── Render / clear circles ────────────────────────────────

  useEffect(() => {
    // Clear existing overlays
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];
    deadZoneCirclesRef.current.forEach((c) => c.setMap(null));
    deadZoneCirclesRef.current = [];
    arrowPolylinesRef.current.forEach((p) => p.setMap(null));
    arrowPolylinesRef.current = [];
    setCoverageCount(0);
    setDeadZones([]);
    setRepositionSuggestions([]);

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

    // Compute coverage density using heat-style gradient
    onDutyWithCoords.forEach((unit) => {
      const lat = Number(unit.latitude);
      const lng = Number(unit.longitude);

      // Count nearby units for coverage intensity
      const nearbyCount = onDutyWithCoords.filter((other) => {
        if (other.call_sign === unit.call_sign) return false;
        const dist = haversineMeters(lat, lng, Number(other.latitude), Number(other.longitude));
        return dist < radiusMeters * 1.5;
      }).length;

      // Heat-style gradient: more units = greener, fewer = redder
      let color: string;
      let opacity: number;
      let strokeOpacity: number;
      if (nearbyCount >= 3) {
        color = '#22c55e'; // deep green = excellent coverage
        opacity = 0.12;
        strokeOpacity = 0.5;
      } else if (nearbyCount === 2) {
        color = '#4ade80'; // light green = good
        opacity = 0.10;
        strokeOpacity = 0.4;
      } else if (nearbyCount === 1) {
        color = '#fbbf24'; // yellow = moderate
        opacity = 0.08;
        strokeOpacity = 0.35;
      } else {
        color = '#f97316'; // orange = sparse (lone unit)
        opacity = 0.06;
        strokeOpacity = 0.3;
      }

      const circle = new google.maps.Circle({
        center: { lat, lng },
        radius: radiusMeters,
        fillColor: color,
        fillOpacity: opacity,
        strokeColor: color,
        strokeWeight: 1.5,
        strokeOpacity,
        map,
        clickable: true,
        zIndex: 3,
      });

      // Info window
      circle.addListener('click', () => {
        const container = document.createElement('div');
        container.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:4px;border:1px solid #1e2a3a";
        const heading = document.createElement('div');
        heading.style.cssText = `font-weight:bold;font-size:12px;margin-bottom:4px;color:${color}`;
        heading.textContent = `Coverage \u2014 ${unit.call_sign}`;
        container.appendChild(heading);

        const densityLabel = nearbyCount >= 3 ? 'Excellent' : nearbyCount === 2 ? 'Good' : nearbyCount === 1 ? 'Moderate' : 'Sparse';
        const density = document.createElement('div');
        density.style.cssText = `font-size:10px;color:${color};font-weight:700;margin-bottom:2px;`;
        density.textContent = `${densityLabel} (${nearbyCount} nearby unit${nearbyCount !== 1 ? 's' : ''})`;
        container.appendChild(density);

        const radius = document.createElement('div');
        radius.style.cssText = 'font-size:9px;color:#6b7280;';
        radius.textContent = `Radius: ${radiusMiles} mi (${Math.round(radiusMeters)} m)`;
        container.appendChild(radius);

        infoWindowRef.current?.setContent(container);
        infoWindowRef.current?.setPosition({ lat, lng });
        infoWindowRef.current?.open(map);
      });

      circlesRef.current.push(circle);
    });

    // ── Dead zone detection ─────────────────────────────────
    // Sample grid points within the visible bounds and find areas
    // where no unit can reach within 5 minutes
    const bounds = map.getBounds();
    if (bounds && onDutyWithCoords.length > 0) {
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const latStep = (ne.lat() - sw.lat()) / 8;
      const lngStep = (ne.lng() - sw.lng()) / 8;
      const foundDeadZones: DeadZone[] = [];

      for (let latI = 0; latI <= 8; latI++) {
        for (let lngI = 0; lngI <= 8; lngI++) {
          const testLat = sw.lat() + latI * latStep;
          const testLng = sw.lng() + lngI * lngStep;

          // Find nearest unit distance
          let minDist = Infinity;
          for (const u of onDutyWithCoords) {
            const d = haversineMeters(testLat, testLng, Number(u.latitude), Number(u.longitude));
            if (d < minDist) minDist = d;
          }

          // If no unit can reach in 5 min, mark as dead zone
          if (minDist > FIVE_MINUTE_METERS) {
            foundDeadZones.push({
              lat: testLat,
              lng: testLng,
              label: `${Math.round(minDist / METERS_PER_MILE * 10) / 10} mi from nearest unit`,
            });

            // Draw dead zone circle (red, semi-transparent)
            const dzCircle = new google.maps.Circle({
              center: { lat: testLat, lng: testLng },
              radius: FIVE_MINUTE_METERS * 0.5,
              fillColor: '#ef4444',
              fillOpacity: 0.06,
              strokeColor: '#ef4444',
              strokeWeight: 1,
              strokeOpacity: 0.25,
              map,
              clickable: true,
              zIndex: 2,
            });

            dzCircle.addListener('click', () => {
              const container = document.createElement('div');
              container.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:11px;color:#e0e0e0;min-width:180px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:4px;border:1px solid #ef444440";
              const heading = document.createElement('div');
              heading.style.cssText = 'font-weight:bold;font-size:12px;margin-bottom:4px;color:#ef4444';
              heading.textContent = 'Dead Zone';
              container.appendChild(heading);
              const info = document.createElement('div');
              info.style.cssText = 'font-size:9px;color:#f87171;';
              info.textContent = `No unit within 5-min response time`;
              container.appendChild(info);
              const dist = document.createElement('div');
              dist.style.cssText = 'font-size:9px;color:#6b7280;margin-top:2px;';
              dist.textContent = `${Math.round(minDist / METERS_PER_MILE * 10) / 10} mi from nearest unit`;
              container.appendChild(dist);
              infoWindowRef.current?.setContent(container);
              infoWindowRef.current?.setPosition({ lat: testLat, lng: testLng });
              infoWindowRef.current?.open(map);
            });

            deadZoneCirclesRef.current.push(dzCircle);
          }
        }
      }
      setDeadZones(foundDeadZones);

      // ── Auto-suggest repositioning ────────────────────────
      // For each dead zone cluster, find the "available" unit furthest from
      // any call and suggest moving toward the gap center
      if (foundDeadZones.length > 0) {
        // Calculate centroid of dead zones
        const dzCenterLat = foundDeadZones.reduce((s, d) => s + d.lat, 0) / foundDeadZones.length;
        const dzCenterLng = foundDeadZones.reduce((s, d) => s + d.lng, 0) / foundDeadZones.length;

        // Find available units (not dispatched/enroute/onscene)
        const availableUnits = onDutyWithCoords.filter(u => u.status === 'available');
        const suggestions: RepositionSuggestion[] = [];

        if (availableUnits.length > 0) {
          // Sort by distance to dead zone center (nearest first for repositioning)
          const sorted = [...availableUnits].sort((a, b) => {
            const dA = haversineMeters(Number(a.latitude), Number(a.longitude), dzCenterLat, dzCenterLng);
            const dB = haversineMeters(Number(b.latitude), Number(b.longitude), dzCenterLat, dzCenterLng);
            return dA - dB;
          });

          // Suggest up to 2 closest available units move toward dead zone center
          sorted.slice(0, 2).forEach((unit) => {
            const fromLat = Number(unit.latitude);
            const fromLng = Number(unit.longitude);
            // Suggest moving halfway toward the dead zone center
            const toLat = (fromLat + dzCenterLat) / 2;
            const toLng = (fromLng + dzCenterLng) / 2;

            suggestions.push({
              fromCallSign: unit.call_sign,
              fromLat,
              fromLng,
              toLat,
              toLng,
            });

            // Draw suggestion arrow
            const arrowPath = [
              { lat: fromLat, lng: fromLng },
              { lat: toLat, lng: toLng },
            ];
            const arrowLine = new google.maps.Polyline({
              path: arrowPath,
              strokeColor: '#60a5fa',
              strokeWeight: 2,
              strokeOpacity: 0.6,
              map,
              zIndex: 5,
              icons: [{
                icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, fillColor: '#60a5fa', fillOpacity: 0.8, strokeWeight: 1, strokeColor: '#fff' },
                offset: '100%',
              }],
            });
            arrowPolylinesRef.current.push(arrowLine);
          });
        }
        setRepositionSuggestions(suggestions);
      }
    }

    setCoverageCount(onDutyWithCoords.length);

    return () => {
      circlesRef.current.forEach((c) => c.setMap(null));
      circlesRef.current = [];
      deadZoneCirclesRef.current.forEach((c) => c.setMap(null));
      deadZoneCirclesRef.current = [];
      arrowPolylinesRef.current.forEach((p) => p.setMap(null));
      arrowPolylinesRef.current = [];
    };
  }, [map, units, enabled, radiusMiles]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      circlesRef.current.forEach((c) => c.setMap(null));
      circlesRef.current = [];
      deadZoneCirclesRef.current.forEach((c) => c.setMap(null));
      deadZoneCirclesRef.current = [];
      arrowPolylinesRef.current.forEach((p) => p.setMap(null));
      arrowPolylinesRef.current = [];
    };
  }, []);

  return { coverageCount, uncoveredArea: coverageCount === 0, deadZones, repositionSuggestions };
}
