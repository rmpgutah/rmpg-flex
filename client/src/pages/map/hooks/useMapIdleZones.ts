// ============================================================
// RMPG Flex — useMapIdleZones
// Finds stretches in a unit's breadcrumb trail where the unit
// stayed within a small radius for more than a threshold
// duration (default: 10 min within 50m). Renders those stretches
// as orange circles on the map so dispatchers can answer
// "which units have been sitting still, and where?" at a glance.
//
// No server round-trip — reuses the playbackTrails the breadcrumb
// effect already fetched. Algorithm is linear in point count.
// ============================================================

import { useEffect, useRef } from 'react';

interface TrailPoint {
  lat: number;
  lng: number;
  time: string;
  status?: string;
}

interface UnitTrail {
  unit_id: number | string;
  call_sign: string;
  points: TrailPoint[];
}

interface UseMapIdleZonesParams {
  mapInstanceRef: React.MutableRefObject<google.maps.Map | null>;
  trails: UnitTrail[];
  enabled: boolean;
  /** Minimum stretch duration to count as "idle" (seconds). */
  minIdleSec?: number;
  /** Max radius a unit can wander and still be "parked" (meters). */
  clusterRadiusM?: number;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface IdleZone {
  callSign: string;
  lat: number;
  lng: number;
  /** Approximate enclosing radius for the visual circle (meters). */
  radiusM: number;
  durationSec: number;
  startTime: string;
  endTime: string;
}

/**
 * Scan a single trail for idle stretches. Greedy anchor-based approach:
 * pick point i as the anchor; extend j forward while every point in
 * [i..j] stays within clusterRadiusM of the anchor. When the cluster
 * breaks, emit a zone if it lasted >= minIdleSec, then restart from j.
 *
 * This runs in O(n) — we never revisit points. Good enough for 1-2k
 * breadcrumb points per unit without noticeable jank.
 */
function findIdleZones(
  trail: UnitTrail,
  minIdleSec: number,
  clusterRadiusM: number,
): IdleZone[] {
  const pts = trail.points || [];
  const zones: IdleZone[] = [];
  if (pts.length < 2) return zones;

  let i = 0;
  while (i < pts.length) {
    const anchor = pts[i];
    let j = i + 1;
    while (j < pts.length && haversineMeters(anchor.lat, anchor.lng, pts[j].lat, pts[j].lng) <= clusterRadiusM) {
      j++;
    }
    // [i..j-1] are all within clusterRadiusM of anchor.
    const startT = Date.parse(pts[i].time);
    const endT = Date.parse(pts[j - 1].time);
    const durationSec = Number.isFinite(startT) && Number.isFinite(endT) ? (endT - startT) / 1000 : 0;

    if (durationSec >= minIdleSec && j - 1 > i) {
      // Centroid of the idle cluster
      let sumLat = 0, sumLng = 0;
      for (let k = i; k < j; k++) { sumLat += pts[k].lat; sumLng += pts[k].lng; }
      const cLat = sumLat / (j - i);
      const cLng = sumLng / (j - i);
      // Max radius for visual sizing — bounded by clusterRadiusM anyway
      let maxR = 0;
      for (let k = i; k < j; k++) {
        maxR = Math.max(maxR, haversineMeters(cLat, cLng, pts[k].lat, pts[k].lng));
      }
      zones.push({
        callSign: trail.call_sign,
        lat: cLat,
        lng: cLng,
        radiusM: Math.max(20, Math.min(clusterRadiusM, maxR)),
        durationSec,
        startTime: pts[i].time,
        endTime: pts[j - 1].time,
      });
      i = j; // Skip ahead past the cluster
    } else {
      i++;
    }
  }
  return zones;
}

export function useMapIdleZones({
  mapInstanceRef,
  trails,
  enabled,
  minIdleSec = 600, // 10 min default
  clusterRadiusM = 50,
}: UseMapIdleZonesParams) {
  const circlesRef = useRef<google.maps.Circle[]>([]);

  useEffect(() => {
    const map = mapInstanceRef.current;

    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];

    if (!map || !enabled || !trails || trails.length === 0) return;

    for (const trail of trails) {
      const zones = findIdleZones(trail, minIdleSec, clusterRadiusM);
      for (const z of zones) {
        const minutes = Math.round(z.durationSec / 60);
        const circle = new google.maps.Circle({
          strokeColor: '#f59e0b',
          strokeOpacity: 0.85,
          strokeWeight: 2,
          fillColor: '#f59e0b',
          fillOpacity: 0.22,
          map,
          center: { lat: z.lat, lng: z.lng },
          radius: z.radiusM,
          zIndex: 900, // Above heatmap, below marker pins
        });
        circle.addListener('click', () => {
          const info = new google.maps.InfoWindow({
            content:
              `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#e5e7eb;background:#0c0c0c;padding:6px 10px;min-width:160px;">` +
              `<div style="color:#f59e0b;font-weight:900;letter-spacing:0.1em;margin-bottom:4px;">IDLE ZONE</div>` +
              `<div>${z.callSign}</div>` +
              `<div style="color:#9ca3af;">${minutes} min${minutes === 1 ? '' : 's'} stationary</div>` +
              `<div style="font-size:9px;color:#6b7280;margin-top:4px;">${new Date(z.startTime).toLocaleTimeString()} — ${new Date(z.endTime).toLocaleTimeString()}</div>` +
              `</div>`,
          });
          info.setPosition({ lat: z.lat, lng: z.lng });
          info.open(map);
        });
        circlesRef.current.push(circle);
      }
    }

    return () => {
      circlesRef.current.forEach((c) => c.setMap(null));
      circlesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, trails, minIdleSec, clusterRadiusM]);
}
