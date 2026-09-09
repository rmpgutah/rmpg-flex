/** Fleet routing backed by the asynchronous Mapbox Optimization V2 engine. */
import { useCallback, useMemo, useRef } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useOptimizationV2 } from '../../../hooks/useOptimizationV2';

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

export function useFleetRouteOptimization(): UseFleetRouteOptimizationResult {
  const optimization = useOptimizationV2();
  const stopsRef = useRef(new Map<number, FleetStop>());
  const startOptimization = useCallback(async (
    vehicleCallSign: string, originLat: number, originLng: number, stops: FleetStop[], shiftStart: string, shiftEnd: string,
  ) => {
    stopsRef.current = new Map(stops.map(s => [s.id, s]));
    await optimization.submit({
      job_type: 'fleet_route',
      problem: {
        version: 1,
        locations: [{ name: 'depot', coordinates: [originLng, originLat] }, ...stops.map(s => ({ name: String(s.id), coordinates: [s.lng, s.lat] as [number, number] }))],
        vehicles: [{ name: vehicleCallSign, routing_profile: 'mapbox/driving-traffic', start_location: 'depot', earliest_start: new Date(shiftStart).toISOString(), latest_end: new Date(shiftEnd).toISOString() }],
        services: stops.map(s => ({ name: String(s.id), location: String(s.id), duration: s.duration ?? 600 })),
        options: { objectives: ['min-schedule-completion-time'] },
      },
    });
  }, [optimization.submit]);
  const optimizedRoute = useMemo<FleetOptimizedRoute | null>(() => {
    const solution = optimization.solution;
    const route = solution?.routes[0];
    if (!solution || !route) return null;
    return {
      vehicleCallSign: route.vehicle,
      totalDistanceMi: (route.distance ?? 0) / 1609.344,
      droppedStopIds: solution.dropped.services.map(Number),
      stops: route.stops.filter(s => s.type === 'service').flatMap(s => (s.services ?? [s.location]).map(id => ({
        stopId: Number(id), name: stopsRef.current.get(Number(id))?.name ?? `Stop ${id}`, eta: s.eta, waitSec: s.wait ?? 0, durationSec: s.duration ?? 0, odometerMi: (s.odometer ?? 0) / 1609.344,
      }))),
    };
  }, [optimization.solution]);
  return { status: optimization.status === 'processing' ? 'pending' : optimization.status,
    elapsedMs: optimization.elapsedMs, optimizedRoute, error: optimization.error, startOptimization, reset: optimization.reset };
}
