// ============================================================
// RMPG Flex — Point-in-Polygon Geofence Utility
// Loads beat.geojson once (lazy singleton) and provides fast
// beat identification via ray-casting algorithm.
// Supports both Polygon and MultiPolygon geometry types.
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------
export interface BeatMatch {
  beat_id: string;
  beat_code: string;
  city: string;
  city_code: string;
  district_letter: string;
  beat_number: number;
}

interface BeatFeature {
  properties: {
    beat_id: string;
    beat_code: string;
    city: string;
    city_code: string;
    district_letter: string;
    beat_number: number;
    [key: string]: any;
  };
  // Each sub-polygon is its own array of rings:
  //   subPolygons[n][0] = outer boundary
  //   subPolygons[n][1..] = holes (if any)
  // For a simple Polygon, there's one sub-polygon.
  // For a MultiPolygon, there are multiple.
  subPolygons: number[][][][];
}

// ----------------------------------------------------------
// Lazy-loaded feature cache (singleton)
// ----------------------------------------------------------
let beatFeatures: BeatFeature[] | null = null;

function loadBeats(): BeatFeature[] {
  if (beatFeatures) return beatFeatures;

  const geojsonPath = path.resolve(__dirname, '../../../client/dist/geojson/beat.geojson');
  if (!fs.existsSync(geojsonPath)) {
    console.warn(`[geofence] beat.geojson not found at ${geojsonPath}`);
    beatFeatures = [];
    return beatFeatures;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));
    const features: BeatFeature[] = [];

    for (const feature of raw.features || []) {
      const geom = feature.geometry;
      if (!geom) continue;

      let subPolygons: number[][][][] = [];

      if (geom.type === 'Polygon') {
        // coordinates = [ring, ring, ...]  where ring = [[lng,lat], ...]
        // Wrap in array so we have one sub-polygon
        subPolygons = [geom.coordinates];
      } else if (geom.type === 'MultiPolygon') {
        // coordinates = [ [ring, ring, ...], [ring, ring, ...], ... ]
        // Each element is a complete polygon with its own outer + holes
        subPolygons = geom.coordinates;
      } else {
        continue;
      }

      features.push({
        properties: feature.properties,
        subPolygons,
      });
    }

    beatFeatures = features;
    console.log(`[geofence] Loaded ${features.length} beat features`);
    return beatFeatures;
  } catch (err) {
    console.error('[geofence] Failed to load beat.geojson:', err);
    beatFeatures = [];
    return beatFeatures;
  }
}

// ----------------------------------------------------------
// Ray-casting point-in-polygon test
// Uses the "crossing number" algorithm — a ray cast from the
// test point rightward (+x) counts how many polygon edges it
// crosses.  Odd crossings = inside.
// ----------------------------------------------------------
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];

    if ((yi > lat) !== (yj > lat)) {
      const intersectX = xj + ((lat - yj) / (yi - yj)) * (xi - xj);
      if (lng < intersectX) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Test whether a point lies inside a polygon (with potential holes).
 * GeoJSON polygon convention:
 *   rings[0] = outer boundary (point must be inside)
 *   rings[1..n] = holes (point must NOT be inside any hole)
 */
function pointInPolygon(lng: number, lat: number, rings: number[][][]): boolean {
  if (!pointInRing(lng, lat, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(lng, lat, rings[h])) return false;
  }
  return true;
}

/**
 * Test whether a point lies inside any sub-polygon of a feature.
 * For MultiPolygon, a point is inside if it's inside ANY sub-polygon.
 */
function pointInFeature(lng: number, lat: number, subPolygons: number[][][][]): boolean {
  for (const polygon of subPolygons) {
    if (pointInPolygon(lng, lat, polygon)) return true;
  }
  return false;
}

// ----------------------------------------------------------
// Public API
// ----------------------------------------------------------

/**
 * Identify which beat zone a GPS coordinate falls within.
 * Returns the matching beat properties or null if outside all zones.
 */
/**
 * Hot-reload geofence data by clearing the cached features
 * and re-reading beat.geojson from disk.
 */
export function reloadGeofence(): void {
  beatFeatures = null;
  loadBeats();
}

export function identifyBeat(lat: number, lng: number): BeatMatch | null {
  const features = loadBeats();

  for (const feature of features) {
    if (pointInFeature(lng, lat, feature.subPolygons)) {
      const p = feature.properties;
      return {
        beat_id: p.beat_id,
        beat_code: p.beat_code,
        city: p.city,
        city_code: p.city_code,
        district_letter: p.district_letter,
        beat_number: p.beat_number,
      };
    }
  }

  return null;
}

/**
 * Batch-identify beats for an array of coordinates.
 * More efficient than calling identifyBeat() in a loop since
 * features are loaded once.
 */
export function identifyBeats(
  points: { lat: number; lng: number }[]
): (BeatMatch | null)[] {
  loadBeats();
  return points.map((p) => identifyBeat(p.lat, p.lng));
}
