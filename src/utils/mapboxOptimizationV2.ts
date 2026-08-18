// ─── Shared V2 problem / solution types ──────────────────────────────────────

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
  time_window?: string | null; // "HH:MM-HH:MM"
  deadline?: string | null;    // ISO datetime
  priority?: string | null;    // '1' | '2' | '3' | 'high' | 'normal' | 'low'
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

function serviceDuration(priority: string | null | undefined): number {
  if (priority === '1' || priority === 'high')   return 30 * 60;
  if (priority === '2' || priority === 'normal') return 20 * 60;
  return 10 * 60;
}

function parseTimeWindow(
  window: string,
  date: string,
): { earliest: string; latest: string } | null {
  const m = window.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) return null;
  return { earliest: `${date}T${m[1]}:00`, latest: `${date}T${m[2]}:00` };
}

// ─── Problem builders ─────────────────────────────────────────────────────────

export function buildServeRunProblem(
  items: ServeStop[],
  officer: UnitRow,
  shiftStart: string,
  shiftEnd: string,
): V2ProblemDocument {
  const date = shiftStart.split('T')[0];
  const depotName = `officer-${officer.id}-depot`;

  const locations: V2Location[] = [
    { name: depotName, coordinates: [officer.longitude ?? 0, officer.latitude ?? 0] },
    ...items.map((s) => ({
      name: String(s.id),
      coordinates: [s.recipient_lng, s.recipient_lat] as [number, number],
    })),
  ];

  const vehicle: V2Vehicle = {
    name: officer.call_sign,
    routing_profile: 'mapbox/driving-traffic',
    start_location: depotName,
    end_location: depotName,
    earliest_start: shiftStart,
    latest_end: shiftEnd,
  };

  const services: V2Service[] = items.map((s) => {
    const svc: V2Service = {
      name: String(s.id),
      location: String(s.id),
      duration: serviceDuration(s.priority),
    };
    if (s.time_window) {
      const tw = parseTimeWindow(s.time_window, date);
      if (tw) svc.service_times = [{ ...tw, type: 'soft' }];
    } else if (s.deadline) {
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
