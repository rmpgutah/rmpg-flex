// ============================================================
// RMPG Flex — Turf.js Geospatial Utilities
// ============================================================
// Wraps @turf/turf operations for CAD-specific spatial tasks:
// - Beat/zone/sector auto-assignment via point-in-polygon
// - Nearest unit calculation
// - Crime hotspot buffer zones
// - Patrol coverage analysis (voronoi)
// - Distance calculations
// ============================================================

import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson';

/**
 * Find which beat/zone/sector a point falls within.
 * Returns the first matching feature, or null if no match.
 */
export function identifyBeat(
  lat: number,
  lng: number,
  beatsGeoJson: FeatureCollection<Polygon | MultiPolygon>
): Feature<Polygon | MultiPolygon> | null {
  const point = turf.point([lng, lat]);
  for (const feature of beatsGeoJson.features) {
    if (turf.booleanPointInPolygon(point, feature)) {
      return feature;
    }
  }
  return null;
}

/**
 * Find the nearest unit to a location from a list of positioned units.
 */
export function findNearestUnit(
  targetLat: number,
  targetLng: number,
  units: Array<{ id: number; callsign: string; latitude: number; longitude: number }>
): { unit: typeof units[0]; distanceMiles: number } | null {
  if (units.length === 0) return null;

  const target = turf.point([targetLng, targetLat]);
  const unitPoints = turf.featureCollection(
    units.map(u => turf.point([u.longitude, u.latitude], { unitId: u.id, callsign: u.callsign }))
  );

  const nearest = turf.nearestPoint(target, unitPoints);
  const matchedUnit = units.find(u => u.id === nearest.properties?.unitId);
  if (!matchedUnit) return null;

  const distance = turf.distance(target, nearest, { units: 'miles' });
  return { unit: matchedUnit, distanceMiles: Math.round(distance * 100) / 100 };
}

/**
 * Create a buffer zone around a point (e.g., crime scene perimeter).
 * Returns a GeoJSON polygon.
 */
export function createBufferZone(
  lat: number,
  lng: number,
  radiusMiles: number
): Feature<Polygon> {
  const point = turf.point([lng, lat]);
  return turf.buffer(point, radiusMiles, { units: 'miles' }) as Feature<Polygon>;
}

/**
 * Calculate distance between two points in miles.
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const from = turf.point([lng1, lat1]);
  const to = turf.point([lng2, lat2]);
  return turf.distance(from, to, { units: 'miles' });
}

/**
 * Generate crime density hotspot clusters from incident points.
 * Returns clustered features with point_count property.
 */
export function clusterIncidents(
  incidents: Array<{ latitude: number; longitude: number; type?: string }>,
  clusterRadiusMiles = 0.25
): FeatureCollection {
  const points = turf.featureCollection(
    incidents.map(i => turf.point([i.longitude, i.latitude], { type: i.type }))
  );
  return turf.clustersDbscan(points, clusterRadiusMiles, { units: 'miles' });
}

/**
 * Create a convex hull around a set of points (e.g., incident cluster boundary).
 */
export function createConvexHull(
  points: Array<{ latitude: number; longitude: number }>
): Feature<Polygon> | null {
  if (points.length < 3) return null;
  const fc = turf.featureCollection(
    points.map(p => turf.point([p.longitude, p.latitude]))
  );
  return turf.convex(fc) as Feature<Polygon> | null;
}

/**
 * Check if a point is within a given radius of another point.
 */
export function isWithinRadius(
  pointLat: number,
  pointLng: number,
  centerLat: number,
  centerLng: number,
  radiusMiles: number
): boolean {
  const distance = calculateDistance(pointLat, pointLng, centerLat, centerLng);
  return distance <= radiusMiles;
}

/**
 * Calculate the center point of a polygon (e.g., beat center for labels).
 */
export function getPolygonCenter(
  feature: Feature<Polygon | MultiPolygon>
): { latitude: number; longitude: number } {
  const center = turf.centroid(feature);
  const [lng, lat] = center.geometry.coordinates;
  return { latitude: lat, longitude: lng };
}

/**
 * Calculate the area of a polygon in square miles.
 */
export function getPolygonArea(
  feature: Feature<Polygon | MultiPolygon>
): number {
  return turf.area(feature) / 2_589_988; // square meters to square miles
}

/**
 * Generate Voronoi diagram for patrol coverage analysis.
 * Given unit positions, creates regions closest to each unit.
 */
export function generatePatrolCoverage(
  units: Array<{ id: number; latitude: number; longitude: number }>,
  boundingBox: [number, number, number, number] // [minLng, minLat, maxLng, maxLat]
): FeatureCollection<Polygon> {
  const points = turf.featureCollection(
    units.map(u => turf.point([u.longitude, u.latitude], { unitId: u.id }))
  );
  const bbox = boundingBox;
  const voronoi = turf.voronoi(points, { bbox });
  return voronoi as FeatureCollection<Polygon>;
}
