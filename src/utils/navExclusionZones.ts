// ============================================================
// Exclusion-zone-aware routing
// ============================================================
// Flags whether a planned route (from the Mapbox Directions proxy,
// src/routes/mapbox.ts) passes through an active `geofence_zones` row
// of zone_type='exclusion'. Reuses the same ray-cast point-in-polygon
// algorithm the server geofence beat-identification pipeline already
// implements (src/utils/geofence.ts) rather than re-deriving it.
// ============================================================

import { pointInPolygon } from './geofence';

export interface ExclusionZone {
  id: number;
  geojsonData: string; // raw geojson_data column value
}

export interface LngLat {
  lng: number;
  lat: number;
}

/**
 * True if any point along routeCoords falls inside any active exclusion
 * zone's polygon. Zones with unparsable JSON are skipped silently — a
 * malformed geofence shouldn't break routing. Zones whose JSON is valid
 * but whose geometry shape isn't one we handle (e.g. MultiPolygon, a
 * FeatureCollection, or a Feature whose geometry.type isn't Polygon) are
 * ALSO skipped (we only ever check the outer ring of a single Polygon),
 * but that's a real active exclusion zone silently never firing — report
 * it via onUnrecognizedShape so it doesn't go unnoticed indefinitely.
 */
export function routeCrossesExclusionZone(
  routeCoords: LngLat[],
  zones: ExclusionZone[],
  onUnrecognizedShape?: (zone: ExclusionZone, shapeType: string | undefined) => void,
): boolean {
  for (const zone of zones) {
    let parsed: any;
    try {
      parsed = JSON.parse(zone.geojsonData);
    } catch {
      continue; // malformed JSON — silently skip
    }
    const polygon: number[][] | undefined =
      parsed?.type === 'Polygon' ? parsed.coordinates?.[0] : parsed?.geometry?.coordinates?.[0];
    if (!polygon) {
      onUnrecognizedShape?.(zone, parsed?.geometry?.type ?? parsed?.type);
      continue;
    }
    for (const point of routeCoords) {
      if (pointInPolygon(point.lng, point.lat, [polygon])) return true;
    }
  }
  return false;
}
