// ─── Shared V2 problem / solution types ──────────────────────────────────────

import { clampDwellSeconds } from './serveStopTiming';
import { denverWallClockToUtcMs } from './serveRouteOptimizer';

export type * from './mapboxOptimizationV2Types';
import type { V2Location, V2Vehicle, V2Service, V2ServiceTime, V2ProblemDocument } from './mapboxOptimizationV2Types';

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
  capabilities?: string[] | null;
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
  /** Optional capability requirements for this call (e.g. ['k9', 'medical']) */
  requirements?: string[] | null;
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
  shiftEndIso?: string,
): { earliest: string; latest: string } | null {
  const normalized = normalizeServeTimeWindow(window);
  if (!normalized) return null;
  const m = normalized.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) return null;
  const day = denverYmdFromIso(shiftStartIso);
  const [year, month, date] = day.split('-').map(Number);
  const toIso = (clock: string) => {
    const [hour, minute] = clock.split(':').map(Number);
    if (hour > 23 || minute > 59) throw new Error('Invalid service time');
    return new Date(denverWallClockToUtcMs(year, month - 1, date, hour, minute)).toISOString();
  };
  const earliest = toIso(m[1]);
  const latest = toIso(m[2]);
  const shiftMs = Date.parse(shiftStartIso);
  const earliestMs = Date.parse(earliest);
  const latestMs = Date.parse(latest);
  // Drop windows that are already over at shift start
  if (Number.isFinite(shiftMs) && Number.isFinite(latestMs) && latestMs <= shiftMs) return null;
  // Drop windows that start after shift end (infeasible constraint)
  if (shiftEndIso) {
    const shiftEndMs = Date.parse(shiftEndIso);
    if (Number.isFinite(shiftEndMs) && Number.isFinite(earliestMs) && earliestMs >= shiftEndMs) return null;
  }
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
  options: {
    circular?: boolean;
    avgMpg?: number | null;
    objective?: 'min-schedule-completion-time' | 'min-total-travel-duration';
    requirements?: string[] | ((stop: ServeStop, index: number) => string[] | null);
  } = {},
): V2ProblemDocument {
  if (officer.latitude == null || officer.longitude == null) throw new Error('Officer needs a current location');
  const depotName = `officer-${officer.id}-depot`;

  const locations: V2Location[] = [
    { name: depotName, coordinates: [officer.longitude ?? 0, officer.latitude ?? 0] },
    ...items.map((s) => ({
      name: String(s.id),
      coordinates: [s.recipient_lng, s.recipient_lat] as [number, number],
    })),
  ];

  const vehicle: V2Vehicle = {
    capabilities: officer.capabilities ?? undefined,
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

  if (vehicle.breaks) vehicle.breaks = vehicle.breaks.filter(b => Date.parse(b.earliest_start) >= Date.parse(shiftStart) && Date.parse(b.latest_end) <= Date.parse(shiftEnd));

  const services: V2Service[] = items.map((s, idx) => {
    const svc: V2Service = {
      name: String(s.id),
      location: String(s.id),
      duration: serveOnsiteDuration(s),
    };
    // Apply caller-supplied requirements to specific stops if provided
    if (options.requirements) {
      const reqs = typeof options.requirements === 'function'
        ? options.requirements(s, idx)
        : options.requirements;
      if (reqs?.length) svc.requirements = reqs;
    }
    const serviceTimes: V2ServiceTime[] = [];
    if (s.time_window) {
      const tw = parseTimeWindow(s.time_window, shiftStart, shiftEnd);
      if (tw) serviceTimes.push({ ...tw, type: 'strict' });
    }
    if (s.deadline) {
      if (serviceTimes.length > 0) {
        // Both time window AND deadline — tighten the window's latest to the
        // earlier of the two so Mapbox cannot schedule past the deadline.
        const deadlineMs = Date.parse(s.deadline);
        if (Number.isFinite(deadlineMs)) {
          const currentLatestMs = Date.parse(serviceTimes[0].latest);
          if (Number.isFinite(currentLatestMs) && deadlineMs < currentLatestMs) {
            serviceTimes[0].latest = new Date(deadlineMs).toISOString();
          }
        }
      } else {
        serviceTimes.push({ earliest: shiftStart, latest: s.deadline, type: 'soft_end' });
      }
    }
    if (serviceTimes.length > 0) svc.service_times = serviceTimes;
    return svc;
  });

  return { version: 1, locations, vehicles: [vehicle], services,
    options: { objectives: [options.objective ?? 'min-schedule-completion-time'], avg_mpg: options.avgMpg ?? null } };
}

export function buildPatrolBeatProblem(
  beats: BeatRow[],
  units: UnitRow[],
  shiftStart: string,
  shiftEnd: string,
  options: { objective?: 'min-schedule-completion-time' | 'min-total-travel-duration'; circular?: boolean } = {},
): V2ProblemDocument {
  if (units.some(u => u.latitude == null || u.longitude == null)) throw new Error('All units need a current location');
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

  const vehicles: V2Vehicle[] = units.map((u) => {
    const v: V2Vehicle = {
      name: u.call_sign,
      routing_profile: 'mapbox/driving-traffic',
      start_location: `unit-${u.id}-start`,
      earliest_start: shiftStart,
      latest_end: shiftEnd,
    };
    // Circular route: return to start after patrol
    if (options.circular !== false) {
      v.end_location = `unit-${u.id}-start`;
    }
    if (u.capabilities?.length) v.capabilities = u.capabilities;
    // Add break at noon for patrol shifts
    const shiftMs = Date.parse(shiftStart);
    if (Number.isFinite(shiftMs)) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Denver',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date(shiftMs));
      const year = Number(parts.find((p) => p.type === 'year')?.value);
      const month = Number(parts.find((p) => p.type === 'month')?.value) - 1;
      const day = Number(parts.find((p) => p.type === 'day')?.value);
      if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
        v.breaks = [{
          earliest_start: new Date(denverWallClockToUtcMs(year, month, day, 12, 0)).toISOString(),
          latest_end: new Date(denverWallClockToUtcMs(year, month, day, 13, 0)).toISOString(),
          duration: 1800,
        }];
      }
    }
    if (v.breaks) v.breaks = v.breaks.filter(b => Date.parse(b.earliest_start) >= Date.parse(shiftStart) && Date.parse(b.latest_end) <= Date.parse(shiftEnd));
    return v;
  });

  const services: V2Service[] = beats.map((b) => ({
    name: `beat-${b.id}`,
    location: `beat-${b.id}`,
  }));

  return { version: 1, locations, vehicles, services,
    options: { objectives: [options.objective ?? 'min-total-travel-duration'] } };
}

export function buildDispatchProblem(
  calls: CallRow[],
  units: UnitRow[],
  options: { objective?: 'min-schedule-completion-time' | 'min-total-travel-duration' } = {},
): V2ProblemDocument {
  if (units.some(u => u.latitude == null || u.longitude == null)) throw new Error('All units need a current location');
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

  const vehicles: V2Vehicle[] = units.map((u) => {
    const v: V2Vehicle = {
      name: u.call_sign,
      routing_profile: 'mapbox/driving-traffic',
      start_location: `unit-${u.id}-start`,
    };
    if (u.capabilities?.length) v.capabilities = u.capabilities;
    return v;
  });

  const services: V2Service[] = calls.map((c) => {
    const svc: V2Service = {
      name: `call-${c.id}`,
      location: `call-${c.id}`,
      duration: serviceDuration(c.priority),
    };
    if (c.requirements?.length) svc.requirements = c.requirements;
    return svc;
  });

  return { version: 1, locations, vehicles, services,
    options: { objectives: [options.objective ?? 'min-schedule-completion-time'] } };
}
