import { apiFetch } from '../hooks/useApi';
/**
 * Mapbox driving-traffic rejects `depart_at` more than ~30 minutes in the past
 * (HTTP 422). Shift start is often 08:00; optimizing at 17:00 must send "now".
 */
export function clampDepartAtForMapbox(departAt: string, nowMs: number = Date.now()): string {
  const t = new Date(departAt).getTime(); // new-date-ok — ISO / epoch from planner, not a D1 naive stamp
  if (!Number.isFinite(t)) return new Date(nowMs).toISOString(); // new-date-ok — epoch ms
  if (nowMs - t > 25 * 60_000) return new Date(nowMs).toISOString(); // new-date-ok — epoch ms
  return new Date(t).toISOString(); // new-date-ok — epoch ms
}

export interface MapboxDirectionsRoute {
  distance?: number;
  duration?: number;
  geometry?: { coordinates?: [number, number][] };
  legs?: Array<{ distance?: number; duration?: number }>;
}

/**
 * Fetch a driving route. Tries live traffic with a legal depart_at, then
 * traffic without depart_at, then the non-traffic driving profile.
 */
export async function fetchMapboxDrivingRoute(
  _token: string,
  coordStr: string,
  departAtIso: string,
): Promise<MapboxDirectionsRoute | null> {
  // Route through the server proxy (/api/mapbox/directions) so the pk.* token
  // never appears in client-side URLs. The token arg is kept for call-site
  // compat but is no longer used — the server supplies it.
  if (!coordStr.includes(';')) return null;
  const clamped = clampDepartAtForMapbox(departAtIso);
  const attempts: Array<{ profile: 'driving-traffic' | 'driving'; depart: boolean }> = [
    { profile: 'driving-traffic', depart: true },
    { profile: 'driving-traffic', depart: false },
    { profile: 'driving', depart: false },
  ];
  for (const attempt of attempts) {
    try {
      const params = new URLSearchParams({
        coordinates: coordStr,
        profile: attempt.profile,
        geometries: 'geojson',
        steps: 'false',
        overview: 'full',
        alternatives: 'false',
      });
      if (attempt.depart) params.set('depart_at', clamped);
      const data = await apiFetch<{ routes?: MapboxDirectionsRoute[] }>(`/mapbox/directions?${params}`);
      const route = data.routes?.[0];
      if (route) return route;
    } catch {
      continue;
    }
  }
  return null;
}
