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
  token: string,
  coordStr: string,
  departAtIso: string,
): Promise<MapboxDirectionsRoute | null> {
  if (!token || !coordStr.includes(';')) return null;
  const clamped = clampDepartAtForMapbox(departAtIso);
  const attempts: Array<{ profile: 'driving-traffic' | 'driving'; depart: boolean }> = [
    { profile: 'driving-traffic', depart: true },
    { profile: 'driving-traffic', depart: false },
    { profile: 'driving', depart: false },
  ];
  for (const attempt of attempts) {
    const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/${attempt.profile}/${coordStr}`);
    url.searchParams.set('access_token', token);
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('steps', 'false');
    url.searchParams.set('overview', 'full');
    if (attempt.depart) url.searchParams.set('depart_at', clamped);
    try {
      const res = await fetch(url.toString());
      if (!res.ok) continue;
      const data = await res.json() as { routes?: MapboxDirectionsRoute[] };
      const route = data.routes?.[0];
      if (route) return route;
    } catch {
      continue;
    }
  }
  return null;
}
