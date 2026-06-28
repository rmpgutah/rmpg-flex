import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from './useApi';

export interface Trip {
  id: number;
  unit_id: number;
  officer_id: number | null;
  trip_type: 'call_response' | 'patrol';
  status: 'active' | 'closed';
  call_id: number | null;
  call_number: string | null;
  call_type: string | null;
  prev_trip_id: number | null;
  start_time: string;
  end_time: string | null;
  close_reason: string | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  start_mileage: number | null;
  end_mileage: number | null;
  distance_m: number;
  duration_s: number | null;
  max_speed: number;        // m/s
  avg_speed: number | null; // m/s
  max_lat_g: number;
  harsh_accel_count: number;
  harsh_brake_count: number;
  harsh_corner_count: number;
  stop_count: number;
  idle_seconds: number;
}

export interface TripPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  time: string;
}

export interface TripDetail extends Trip {
  points: TripPoint[];
}

/** Recent trips for one unit (newest first). reload() to refresh. */
export function useUnitTrips(unitId?: number) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const reload = useCallback(() => {
    // No unit assigned → fall back to the agency-wide recent trip log so the
    // TRIPS view is always viewable (unit_id is optional on the endpoint).
    const q = unitId ? `unit_id=${unitId}&limit=50` : 'limit=50';
    apiFetch<Trip[]>(`/dispatch/trips?${q}`).then(setTrips).catch(console.error);
  }, [unitId]);
  useEffect(reload, [reload]);
  return { trips, reload };
}

/** Full trip + breadcrumb points for replay / movement report. */
export function useTripDetail(id?: number) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  useEffect(() => {
    if (id) apiFetch<TripDetail>(`/dispatch/trips/${id}`).then(setTrip).catch(console.error);
  }, [id]);
  return trip;
}

/** All currently-active trips (one+ per unit) — for the dispatch board badges. */
export function useActiveTrips() {
  const [active, setActive] = useState<Trip[]>([]);
  const reload = useCallback(() => {
    apiFetch<Trip[]>('/dispatch/trips/active').then(setActive).catch(console.error);
  }, []);
  useEffect(reload, [reload]);
  return { active, reload };
}

// ── display helpers (shared across dispatch board, nav drawer, map, PDF) ──
const MPS_TO_MPH = 2.236936;
export const tripMiles = (t: Trip): number => t.distance_m / 1609.34;
export const tripMaxMph = (t: Trip): number => Math.round(t.max_speed * MPS_TO_MPH);
export const tripDurationMin = (t: Trip): number | null =>
  t.duration_s != null ? Math.round(t.duration_s / 60) : null;
export const tripLabel = (t: Trip): string =>
  t.trip_type === 'call_response' ? `RESPONSE${t.call_number ? ' ' + t.call_number : ''}` : 'PATROL';
export const tripHarshTotal = (t: Trip): number =>
  t.harsh_accel_count + t.harsh_brake_count + t.harsh_corner_count;
