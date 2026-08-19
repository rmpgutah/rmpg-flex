/**
 * Fleet Route Optimizer hook.
 *
 * Uses a client-side nearest-neighbor + 2-opt algorithm (same approach as
 * src/utils/routeOptimizer.ts on the Worker) so it works without needing
 * fleet stops to exist in any D1 table.  Geocoding goes through the existing
 * GET /api/mapbox/geocode?q= proxy.
 */

import { useState, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';

// ─── Public types ────────────────────────────────────────────────────────────

export interface FleetStop {
  id: number;
  name: string;   // location label / address string
  lat: number;
  lng: number;
  duration?: number;  // seconds on-site (default 600 = 10 min)
}

export interface FleetOptimizedStop {
  stopId: number;
  name: string;
  eta: string;        // ISO timestamp (Denver local)
  waitSec: number;
  durationSec: number;
  odometerMi: number; // cumulative distance from origin
}

export interface FleetOptimizedRoute {
  vehicleCallSign: string;
  stops: FleetOptimizedStop[];
  totalDistanceMi: number;
  droppedStopIds: number[];  // stops with no valid coords (shouldn't happen here)
}

export interface UseFleetRouteOptimizationResult {
  status: 'idle' | 'pending' | 'complete' | 'error';
  elapsedMs: number;
  optimizedRoute: FleetOptimizedRoute | null;
  error: string | null;
  startOptimization: (
    vehicleCallSign: string,
    originLat: number,
    originLng: number,
    stops: FleetStop[],
    shiftStart: string,   // ISO  e.g. "2026-08-18T07:00:00"
    shiftEnd: string,
  ) => Promise<void>;
  reset: () => void;
}

// ─── Geocode helper ───────────────────────────────────────────────────────────

interface GeoFeature {
  geometry?: { coordinates?: [number, number] };
  place_name?: string;
}
interface GeoResponse {
  features?: GeoFeature[];
}

export async function geocodeAddress(q: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await apiFetch<GeoResponse>(
      `/mapbox/geocode?q=${encodeURIComponent(q)}&limit=1&country=us&proximity=-111.891,40.7608`,
    );
    const coords = res?.features?.[0]?.geometry?.coordinates;
    if (!coords) return null;
    return { lat: coords[1], lng: coords[0] };
  } catch {
    return null;
  }
}

// ─── Haversine distance (miles) ───────────────────────────────────────────────

function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3_958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Nearest-neighbor + 2-opt ─────────────────────────────────────────────────

interface Pt { id: number; lat: number; lng: number }

function nearestNeighbor<T extends Pt>(origin: Pt, stops: T[]): T[] {
  const remaining = [...stops];
  const ordered: T[] = [];
  let cur: Pt = origin;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMi(cur.lat, cur.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    cur = remaining[bestIdx];
    ordered.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return ordered;
}

function routeDistance(origin: Pt, stops: Pt[]): number {
  let d = 0;
  let prev = origin;
  for (const s of stops) {
    d += haversineMi(prev.lat, prev.lng, s.lat, s.lng);
    prev = s;
  }
  return d;
}

function twoOpt<T extends Pt>(origin: Pt, stops: T[]): T[] {
  let best = [...stops];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        if (routeDistance(origin, candidate) < routeDistance(origin, best)) {
          best = candidate;
          improved = true;
        }
      }
    }
  }
  return best;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const AVG_SPEED_MPH = 30; // conservative urban estimate

export function useFleetRouteOptimization(): UseFleetRouteOptimizationResult {
  const [status, setStatus] = useState<UseFleetRouteOptimizationResult['status']>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [optimizedRoute, setOptimizedRoute] = useState<FleetOptimizedRoute | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setElapsedMs(0);
    setOptimizedRoute(null);
    setError(null);
  }, []);

  const startOptimization = useCallback(async (
    vehicleCallSign: string,
    originLat: number,
    originLng: number,
    stops: FleetStop[],
    shiftStart: string,
    _shiftEnd: string,
  ) => {
    reset();
    setStatus('pending');
    const t0 = Date.now();

    try {
      const origin: Pt = { id: -1, lat: originLat, lng: originLng };
      const pts: (Pt & { stop: FleetStop })[] = stops.map((s) => ({
        id: s.id, lat: s.lat, lng: s.lng, stop: s,
      }));

      // Optimize
      const nn = nearestNeighbor(origin, pts);
      const ordered = pts.length <= 10 ? twoOpt(origin, nn) : nn; // 2-opt expensive for large sets

      // Build ETA chain from shiftStart
      let cursor = new Date(shiftStart).getTime(); // new-date-ok: datetime-local input value (local wall-clock)
      let odometerMi = 0;
      let prevLat = originLat;
      let prevLng = originLng;

      const resultStops: FleetOptimizedStop[] = ordered.map((pt) => {
        const legMi = haversineMi(prevLat, prevLng, pt.lat, pt.lng);
        const legMs = (legMi / AVG_SPEED_MPH) * 3_600_000;
        cursor += legMs;
        odometerMi += legMi;
        const eta = new Date(cursor).toISOString(); // new-date-ok: cursor is an epoch number (ms since Unix epoch)
        const dur = (pt.stop.duration ?? 600) * 1000;
        cursor += dur; // advance past on-site time
        prevLat = pt.lat;
        prevLng = pt.lng;
        return {
          stopId: pt.stop.id,
          name: pt.stop.name,
          eta,
          waitSec: 0,
          durationSec: pt.stop.duration ?? 600,
          odometerMi: Math.round(odometerMi * 100) / 100,
        };
      });

      const totalDistanceMi = Math.round(odometerMi * 100) / 100;

      setOptimizedRoute({
        vehicleCallSign,
        stops: resultStops,
        totalDistanceMi,
        droppedStopIds: [],
      });
      setElapsedMs(Date.now() - t0);
      setStatus('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed');
      setStatus('error');
    }
  }, [reset]);

  return { status, elapsedMs, optimizedRoute, error, startOptimization, reset };
}
