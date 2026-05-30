// ============================================================
// RMPG Flex — Server-side geofence (Worker)
//
// Point-in-polygon beat identification for the dispatch geography
// pipeline. The legacy VPS ray-cast against client/public/geojson/
// beat.geojson on disk; on Workers we can't read Pages static assets,
// so the same file is stored in R2 (MAP_DATA, key `geojson/beat.geojson`)
// and read via the binding — no WAF, same-region, no auth.
//
// The parsed polygon set (~719 beats) is cached in module scope so only
// the first request on a cold isolate pays the R2 fetch + JSON.parse.
// A bbox fast-reject keeps the per-request scan to a few ms.
// ============================================================

import type { Bindings } from '../types';

const R2_BEAT_KEY = 'geojson/beat.geojson';

// Six towns share a city_code with a same-prefix sibling in the geojson
// (Midway/Millcreek both "MI2", etc.). The live DB resolves the clash by giving
// the SECOND town its own zone, coded "<city_code>-<county_nbr>". The geojson
// only carries the shared city_code, so we remap by the (unique) city name to
// the DB zone_code those reparented beats actually live under. Without this a
// Midway GPS hit would resolve to Millcreek. Keep in sync with the live
// dispatch_zones for these towns.
const ZONE_CODE_BY_CITY: Record<string, string> = {
  Midway: 'MI2-26',     // Wasatch County
  Marysvale: 'MA2-16',  // Piute County
  Mona: 'MO2-12',       // Juab County
  Richfield: 'RI2-21',  // Sevier County
  Salina: 'SA2-21',     // Sevier County
  Cleveland: 'CL2-08',  // Emery County
};

// A geofence hit, expressed in the keys the DB join needs. The geojson stores
// city_code / district_letter / beat_number, which map to the live
// dispatch_beats table as:
//   zone_code = city_code (or the ZONE_CODE_BY_CITY override above)
//   beat_code = `${district_letter}${beat_number}`  for incorporated beats
//   beat_code = the raw "<CITY>-UNINC" code         for county catch-alls
export interface BeatHit {
  zone_code: string;
  beat_code: string;
  city: string;
}

// One beat's geometry, pre-flattened for cheap scanning.
interface BeatShape extends BeatHit {
  // The 29 county "-UNINC" catch-all polygons fully overlap the 690
  // incorporated city beats nested inside them, so a downtown point matches
  // BOTH. We must prefer the specific city beat — this flag lets identify()
  // treat the catch-all only as a last resort.
  incorporated: boolean;
  // axis-aligned bounding box for O(1) reject before ring math
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  // [polygon][ring][point] = [lng, lat]; ring[0] is the outer boundary,
  // ring[1..] are holes (GeoJSON Polygon/MultiPolygon convention).
  polygons: number[][][][];
}

let cache: BeatShape[] | null = null;
let inflight: Promise<BeatShape[]> | null = null;

async function loadBeats(env: Bindings): Promise<BeatShape[]> {
  if (cache) return cache;
  // De-dupe concurrent cold-start loads onto a single R2 fetch.
  if (inflight) return inflight;

  inflight = (async () => {
    const obj = await env.MAP_DATA.get(R2_BEAT_KEY);
    if (!obj) throw new Error(`geofence: R2 object "${R2_BEAT_KEY}" not found`);
    const fc = (await obj.json()) as {
      features?: Array<{
        properties?: {
          beat_code?: unknown;
          city_code?: unknown;
          city?: unknown;
          district_letter?: unknown;
          beat_number?: unknown;
        };
        geometry?: { type: string; coordinates: unknown };
      }>;
    };

    const shapes: BeatShape[] = [];
    for (const f of fc.features ?? []) {
      const p = f.properties;
      const rawCode = p?.beat_code;
      const cityCode = p?.city_code;
      if (typeof rawCode !== 'string' || typeof cityCode !== 'string' || !f.geometry) continue;

      const city = typeof p?.city === 'string' ? p.city : '';
      // Honor the second-town zone override before falling back to city_code.
      const zone_code = ZONE_CODE_BY_CITY[city] ?? cityCode;

      // Reproduce the DB's beat_code: county catch-alls keep their literal
      // "<CITY>-UNINC" code; incorporated beats are district_letter+beat_number
      // (e.g. "B1"). See dispatch_beats on live D1.
      const incorporated = !rawCode.endsWith('-UNINC');
      const beat_code = incorporated
        ? `${p?.district_letter ?? ''}${p?.beat_number ?? ''}`
        : rawCode;

      const geom = f.geometry;
      const polygons: number[][][][] =
        geom.type === 'Polygon'
          ? [geom.coordinates as number[][][]]
          : geom.type === 'MultiPolygon'
          ? (geom.coordinates as number[][][][])
          : [];
      if (polygons.length === 0) continue;

      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      for (const poly of polygons) {
        for (const ring of poly) {
          for (const pt of ring) {
            const lng = pt[0], lat = pt[1];
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
        }
      }

      shapes.push({
        zone_code, beat_code, city, incorporated,
        minLng, minLat, maxLng, maxLat,
        polygons,
      });
    }

    cache = shapes;
    return shapes;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

// Ray-casting (even-odd) test for a single ring.
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Inside the outer ring AND outside every hole.
function pointInPolygon(lng: number, lat: number, rings: number[][][]): boolean {
  if (rings.length === 0 || !pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lng, lat, rings[i])) return false; // in a hole
  }
  return true;
}

/**
 * Identify the beat whose polygon contains (lat, lng), or null if the point
 * falls in no beat. Loads + caches beat geometry from R2 on first call.
 * Returns DB-join keys ({ zone_code, beat_code, city }), not the raw geojson
 * beat_code.
 */
export async function identifyBeat(
  env: Bindings,
  lat: number,
  lng: number,
): Promise<BeatHit | null> {
  const beats = await loadBeats(env);
  // An incorporated city beat wins immediately; remember any "-UNINC" county
  // catch-all as a fallback in case the point is in no city beat.
  let uninc: BeatHit | null = null;
  for (const b of beats) {
    if (lng < b.minLng || lng > b.maxLng || lat < b.minLat || lat > b.maxLat) continue;
    let contained = false;
    for (const poly of b.polygons) {
      if (pointInPolygon(lng, lat, poly)) { contained = true; break; }
    }
    if (!contained) continue;
    const hit: BeatHit = { zone_code: b.zone_code, beat_code: b.beat_code, city: b.city };
    if (b.incorporated) return hit;
    if (uninc === null) uninc = hit;
  }
  return uninc;
}
