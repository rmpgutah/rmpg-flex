// ============================================================
// RMPG Flex — Geofence zone math (pure functions, no D1/Workers deps)
//
// Point-in-polygon test for the geofence_zones table's stored
// geojson_data — a stringified FeatureCollection produced by
// DrawGeofenceTool.tsx (client/src/pages/map/components/DrawGeofenceTool.tsx)
// via @mapbox/mapbox-gl-draw's `draw.getAll()`. Ray-casting logic mirrors
// (but does not import, to keep this module dependency-free of the R2
// binding) pointInRing/pointInPolygon in src/utils/geofence.ts, which
// does the same test against beat boundaries.
// ============================================================

export interface ParsedZone {
  // [polygon][ring][point] = [lng, lat]. ring[0] = outer boundary,
  // ring[1..] = holes (GeoJSON Polygon convention).
  polygons: number[][][][];
}

/** Ray-casting (even-odd) test for a single ring. */
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

/** Inside the outer ring AND outside every hole, for one polygon's rings. */
function pointInPolygonRings(lng: number, lat: number, rings: number[][][]): boolean {
  if (rings.length === 0 || !pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lng, lat, rings[i])) return false; // in a hole
  }
  return true;
}

/** True if (lat, lng) falls inside ANY polygon in the zone (a zone may be
 *  drawn as multiple disjoint shapes in one FeatureCollection). */
export function pointInAnyPolygon(lng: number, lat: number, polygons: number[][][][]): boolean {
  for (const rings of polygons) {
    if (pointInPolygonRings(lng, lat, rings)) return true;
  }
  return false;
}

/**
 * Parse a geofence_zones.geojson_data string (a FeatureCollection of
 * Polygon/MultiPolygon features) into flattened polygon-ring arrays.
 * Never throws — malformed/empty input returns an empty array so a bad
 * row can't break the whole detection pass for every other zone.
 */
export function parseZoneFeatures(geojsonData: string): ParsedZone[] {
  let parsed: any;
  try {
    parsed = JSON.parse(geojsonData);
  } catch {
    return [];
  }
  const features = Array.isArray(parsed?.features) ? parsed.features : [];
  const zones: ParsedZone[] = [];
  for (const f of features) {
    const geom = f?.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
      zones.push({ polygons: [geom.coordinates] });
    } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
      zones.push({ polygons: geom.coordinates });
    }
  }
  return zones;
}

export type ZoneTransition =
  | { type: 'enter'; zoneId: number }
  | { type: 'exit'; zoneId: number }
  | { type: 'transfer'; exitedZoneId: number; enteredZoneId: number };

/**
 * Compare a unit's previous zone membership (or null if outside every
 * zone) against its current membership, and return the transition to
 * record, or null if nothing changed. A unit can only be "in" one zone
 * at a time in this model (see Task 1's migration note on
 * unit_geofence_state) — if it's simultaneously inside two overlapping
 * zones, the caller picks one currentZoneId (first match wins).
 */
export function diffZoneMembership(
  previousZoneId: number | null,
  currentZoneId: number | null,
): ZoneTransition | null {
  if (previousZoneId === currentZoneId) return null;
  if (previousZoneId === null && currentZoneId !== null) {
    return { type: 'enter', zoneId: currentZoneId };
  }
  if (previousZoneId !== null && currentZoneId === null) {
    return { type: 'exit', zoneId: previousZoneId };
  }
  // both non-null and different
  return { type: 'transfer', exitedZoneId: previousZoneId as number, enteredZoneId: currentZoneId as number };
}
