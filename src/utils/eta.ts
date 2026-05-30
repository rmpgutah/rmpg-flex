// ============================================================
// RMPG Flex — ETA estimation (Worker)
// ============================================================
// Answers "what's my ETA" for the AI dispatcher. The dispatcher's spoken
// reply is synthesized server-side, so the drive-time has to resolve on the
// Worker BEFORE TTS — it can't be deferred to the client.
//
// Two paths, picked automatically:
//   1. Mapbox Directions (driving-traffic) — a real road ETA, used ONLY when
//      a MAPBOX_ACCESS_TOKEN secret is set on the Worker.
//   2. Straight-line estimate — a token-free fallback so the sentence always
//      resolves. Great-circle distance × a road-winding factor ÷ an effective
//      patrol speed. Honest by construction: callers phrase it as "about N
//      minutes", never a precise routed time.
//
// Best-effort: any failure degrades from Mapbox → estimate, never throws.
// ============================================================

export interface LatLng { lat: number; lng: number }

export interface EtaEstimate {
  /** Whole minutes, always ≥ 1. */
  minutes: number;
  /** Road-ish miles (one decimal). */
  miles: number;
  /** Where the number came from — lets the caller hedge its phrasing. */
  source: 'mapbox' | 'estimate';
}

// ─── OPERATOR KNOBS (TUNE ME) ───────────────────────────────
// The straight-line fallback is only as good as these two numbers. They are
// the operator-owned model the same way DISPATCH_POLICY is the persona knob.
//
//   EFFECTIVE_PATROL_MPH — average door-to-door speed of a routine (non-Code-3)
//     response across the Wasatch Front: surface streets, lights, and the odd
//     turn-around pull it well below any posted limit. 22 mph is a calm
//     default; raise it if RMPG's beats are freeway-heavy, lower it for dense
//     downtown grids. (A true Mapbox driving-traffic ETA overrides this whenever
//     a token is configured, so this only governs the token-free fallback.)
//   ROAD_WINDING_FACTOR — multiplier from great-circle ("as the crow flies")
//     to actual road miles. ~1.3 is typical for a gridded city; bump toward
//     1.5 in areas where the road network bends around terrain (canyons, lakes).
const EFFECTIVE_PATROL_MPH = 22;
const ROAD_WINDING_FACTOR = 1.3;

const EARTH_RADIUS_MI = 3958.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two coordinates, in miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Straight-line fallback — no network, never throws.
function estimateFromDistance(from: LatLng, to: LatLng): EtaEstimate {
  const roadMiles = haversineMiles(from, to) * ROAD_WINDING_FACTOR;
  const minutes = Math.max(1, Math.round((roadMiles / EFFECTIVE_PATROL_MPH) * 60));
  return { minutes, miles: round1(roadMiles), source: 'estimate' };
}

interface MapboxDirectionsResponse {
  routes?: Array<{ duration?: number; distance?: number }>;
}

/**
 * Estimate drive time from `from` to `to`. Uses Mapbox Directions
 * (driving-traffic) when env.MAPBOX_ACCESS_TOKEN is set; otherwise — or on any
 * Mapbox error — falls back to a straight-line estimate. ALWAYS resolves.
 */
export async function estimateEta(
  env: { MAPBOX_ACCESS_TOKEN?: string },
  from: LatLng,
  to: LatLng,
): Promise<EtaEstimate> {
  const token = env.MAPBOX_ACCESS_TOKEN?.trim();
  if (token) {
    try {
      // Mapbox wants lng,lat order. overview=false → no geometry payload.
      const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
      const url =
        `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
        `?overview=false&access_token=${encodeURIComponent(token)}`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'RMPG-Flex-Dispatch/1.0' } });
      if (resp.ok) {
        const data = await resp.json<MapboxDirectionsResponse>();
        const route = data.routes?.[0];
        if (route && Number.isFinite(route.duration) && Number.isFinite(route.distance)) {
          return {
            minutes: Math.max(1, Math.round((route.duration as number) / 60)),
            miles: round1((route.distance as number) / 1609.34),
            source: 'mapbox',
          };
        }
      }
    } catch {
      // fall through to the estimate
    }
  }
  return estimateFromDistance(from, to);
}
