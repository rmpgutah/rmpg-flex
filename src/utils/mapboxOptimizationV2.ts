// ─── Shared V2 problem / solution types ──────────────────────────────────────

import { clampDwellSeconds } from './serveStopTiming';
import { denverWallClockToUtcMs } from './serveRouteOptimizer';

export interface V2Location {
  name: string;
  coordinates: [number, number]; // [lng, lat]
}

export interface V2Vehicle {
  name: string;
  routing_profile?: string;
  start_location?: string;
  end_location?: string;
  earliest_start?: string;
  latest_end?: string;
  breaks?: { earliest_start: string; latest_end: string; duration: number }[];
}

export interface V2ServiceTime {
  earliest: string;
  latest: string;
  type?: 'strict' | 'soft' | 'soft_start' | 'soft_end';
}

export interface V2Service {
  name: string;
  location: string;
  duration?: number;
  service_times?: V2ServiceTime[];
}

export interface V2ProblemDocument {
  version: 1;
  locations: V2Location[];
  vehicles: V2Vehicle[];
  services: V2Service[];
  options?: { objectives?: string[] };
}

export interface V2Stop {
  type: 'start' | 'service' | 'pickup' | 'dropoff' | 'break' | 'end';
  location: string;
  eta: string;
  odometer?: number;
  wait?: number;
  duration?: number;
  services?: string[];
}

export interface V2Route {
  vehicle: string;
  stops: V2Stop[];
}

export interface V2Solution {
  dropped: { services: string[]; shipments: string[] };
  routes: V2Route[];
}

// ─── Input row types (minimal — only what builders need) ─────────────────────

export interface ServeStop {
  id: number;
  recipient_address: string;
  recipient_lat: number;
  recipient_lng: number;
  time_window?: string | null;
  deadline?: string | null;
  priority?: string | null;
  business_id?: number | null;
  recipient_type?: string | null;
}

export interface UnitRow {
  id: number;
  call_sign: string;
  latitude?: number | null;
  longitude?: number | null;
  earliest_start?: string | null;
  latest_end?: string | null;
}

export interface BeatRow {
  id: number;
  beat_code: string;
  min_lat?: number | null;
  max_lat?: number | null;
  min_lng?: number | null;
  max_lng?: number | null;
}

export interface CallRow {
  id: number;
  incident_number?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  priority?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serveOnsiteDuration(stop: ServeStop): number {
  const type = stop.business_id || (stop.recipient_type || '').toLowerCase() === 'business'
    ? 'business'
    : /\b(apt|apartment|unit|ste|suite)\b/i.test(stop.recipient_address || '')
      ? 'apartment'
      : 'individual';
  return clampDwellSeconds(type);
}

function serviceDuration(priority: string | null | undefined): number {
  if (priority === '1' || priority === 'high')   return 30 * 60;
  if (priority === '2' || priority === 'normal') return 20 * 60;
  return 10 * 60;
}

function normalizeServeTimeWindow(window: string | null | undefined): string | null {
  if (!window) return null;
  switch (window) {
    case 'morning': return '06:00-12:00';
    case 'afternoon': return '12:00-17:00';
    case 'evening': return '17:00-21:00';
    case 'anytime': return null;
    default: return /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(window) ? window : null;
  }
}

function denverYmdFromIso(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

function parseTimeWindow(
  window: string,
  shiftStartIso: string,
): { earliest: string; latest: string } | null {
  const normalized = normalizeServeTimeWindow(window);
  if (!normalized) return null;
  const m = normalized.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) return null;
  const day = denverYmdFromIso(shiftStartIso);
  const earliest = `${day}T${m[1]}:00-06:00`;
  const latest = `${day}T${m[2]}:00-06:00`;
  const shiftMs = Date.parse(shiftStartIso);
  const latestMs = Date.parse(latest);
  // Morning 08:00–12:00 is already over at a 18:15 start — do not hand Mapbox
  // a window that forces 08:00 tomorrow.
  if (Number.isFinite(shiftMs) && Number.isFinite(latestMs) && latestMs <= shiftMs) return null;
  return { earliest, latest };
}

/** Worker-side token for Optimization V2. sk.* is allowed here — this never
 *  leaves the Worker. Public pk tokens without V2 scope 401; the secret
 *  token is what production actually has configured. */
export function resolveOptimizationV2Token(env: {
  MAPBOX_SECRET_TOKEN?: string;
  MAPBOX_ACCESS_TOKEN?: string;
}): string | null {
  const secret = (env.MAPBOX_SECRET_TOKEN || '').trim();
  if (secret) return secret;
  const access = (env.MAPBOX_ACCESS_TOKEN || '').trim();
  return access || null;
}

// ─── Problem builders ─────────────────────────────────────────────────────────

export function buildServeRunProblem(
  items: ServeStop[],
  officer: UnitRow,
  shiftStart: string,
  shiftEnd: string,
  options: { circular?: boolean } = {},
): V2ProblemDocument {
  const depotName = `officer-${officer.id}-depot`;

  const locations: V2Location[] = [
    { name: depotName, coordinates: [officer.longitude ?? 0, officer.latitude ?? 0] },
    ...items.map((s) => ({
      name: String(s.id),
      coordinates: [s.recipient_lng, s.recipient_lat] as [number, number],
    })),
  ];

  const vehicle: V2Vehicle = {
    name: officer.call_sign || `officer-${officer.id}`,
    routing_profile: 'mapbox/driving-traffic',
    start_location: depotName,
    earliest_start: shiftStart,
    latest_end: shiftEnd,
  };
  if (options.circular !== false) {
    vehicle.end_location = depotName;
  }
  const shiftMs = Date.parse(shiftStart);
  if (Number.isFinite(shiftMs)) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(shiftMs)); // new-date-ok — ISO shift start
    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value) - 1;
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      vehicle.breaks = [{
        earliest_start: new Date(denverWallClockToUtcMs(year, month, day, 12, 0)).toISOString(),
        latest_end: new Date(denverWallClockToUtcMs(year, month, day, 13, 0)).toISOString(),
        duration: 1800,
      }];
    }
  }

  const services: V2Service[] = items.map((s) => {
    const svc: V2Service = {
      name: String(s.id),
      location: String(s.id),
      duration: serveOnsiteDuration(s),
    };
    if (s.time_window) {
      const tw = parseTimeWindow(s.time_window, shiftStart);
      if (tw) svc.service_times = [{ ...tw, type: 'soft' }];
    }
    if (!svc.service_times && s.deadline) {
      svc.service_times = [{ earliest: shiftStart, latest: s.deadline, type: 'soft_end' }];
    }
    return svc;
  });

  return { version: 1, locations, vehicles: [vehicle], services,
    options: { objectives: ['min-schedule-completion-time'] } };
}

export function buildPatrolBeatProblem(
  beats: BeatRow[],
  units: UnitRow[],
  shiftStart: string,
  shiftEnd: string,
): V2ProblemDocument {
  const locations: V2Location[] = [
    ...units.map((u) => ({
      name: `unit-${u.id}-start`,
      coordinates: [u.longitude ?? 0, u.latitude ?? 0] as [number, number],
    })),
    ...beats.map((b) => ({
      name: `beat-${b.id}`,
      coordinates: [
        ((b.min_lng ?? 0) + (b.max_lng ?? 0)) / 2,
        ((b.min_lat ?? 0) + (b.max_lat ?? 0)) / 2,
      ] as [number, number],
    })),
  ];

  const vehicles: V2Vehicle[] = units.map((u) => ({
    name: u.call_sign,
    routing_profile: 'mapbox/driving',
    start_location: `unit-${u.id}-start`,
    earliest_start: shiftStart,
    latest_end: shiftEnd,
  }));

  const services: V2Service[] = beats.map((b) => ({
    name: `beat-${b.id}`,
    location: `beat-${b.id}`,
  }));

  return { version: 1, locations, vehicles, services,
    options: { objectives: ['min-total-travel-duration'] } };
}

export function buildDispatchProblem(
  calls: CallRow[],
  units: UnitRow[],
): V2ProblemDocument {
  const locations: V2Location[] = [
    ...units.map((u) => ({
      name: `unit-${u.id}-start`,
      coordinates: [u.longitude ?? 0, u.latitude ?? 0] as [number, number],
    })),
    ...calls.map((c) => ({
      name: `call-${c.id}`,
      coordinates: [c.longitude ?? 0, c.latitude ?? 0] as [number, number],
    })),
  ];

  const vehicles: V2Vehicle[] = units.map((u) => ({
    name: u.call_sign,
    routing_profile: 'mapbox/driving-traffic',
    start_location: `unit-${u.id}-start`,
  }));

  const services: V2Service[] = calls.map((c) => ({
    name: `call-${c.id}`,
    location: `call-${c.id}`,
    duration: serviceDuration(c.priority),
  }));

  return { version: 1, locations, vehicles, services,
    options: { objectives: ['min-schedule-completion-time'] } };
}
