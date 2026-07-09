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
 * zone's polygon. Zones with unparsable/missing geometry are skipped
 * rather than throwing — a malformed geofence shouldn't break routing.
 */
export function routeCrossesExclusionZone(routeCoords: LngLat[], zones: ExclusionZone[]): boolean {
  for (const zone of zones) {
    let polygon: number[][] | undefined;
    try {
      const parsed = JSON.parse(zone.geojsonData);
      polygon = parsed?.type === 'Polygon' ? parsed.coordinates?.[0] : parsed?.geometry?.coordinates?.[0];
    } catch {
      continue;
    }
    if (!polygon) continue;
    for (const point of routeCoords) {
      if (pointInPolygon(point.lng, point.lat, [polygon])) return true;
    }
  }
  return false;
}
