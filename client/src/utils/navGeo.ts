// ============================================================
// RMPG Flex — Navigation Geo Primitives
// Pure spherical-earth math reused by waypoints, the crow-flies
// readout, trail decimation, and bearing displays. No DOM, no
// React, no network — safe to import anywhere (incl. workers/tests).
// ============================================================

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8; // IUGG mean Earth radius
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Great-circle distance between two points, in METERS (haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const φ1 = a.lat * DEG2RAD;
  const φ2 = b.lat * DEG2RAD;
  const dφ = (b.lat - a.lat) * DEG2RAD;
  const dλ = (b.lng - a.lng) * DEG2RAD;
  const sinφ = Math.sin(dφ / 2);
  const sinλ = Math.sin(dλ / 2);
  const h = sinφ * sinφ + Math.cos(φ1) * Math.cos(φ2) * sinλ * sinλ;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

/**
 * Initial bearing (forward azimuth) from `a` to `b`, in DEGREES,
 * normalized to [0, 360). 0 = true north, 90 = east.
 */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = a.lat * DEG2RAD;
  const φ2 = b.lat * DEG2RAD;
  const dλ = (b.lng - a.lng) * DEG2RAD;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const θ = Math.atan2(y, x) * RAD2DEG;
  return (θ + 360) % 360;
}

/**
 * Project a point a given distance (METERS) along a bearing (DEGREES)
 * from an origin, returning the destination lat/lng (spherical).
 */
export function movePoint(origin: LatLng, bearing: number, meters: number): LatLng {
  const δ = meters / EARTH_RADIUS_M; // angular distance
  const θ = bearing * DEG2RAD;
  const φ1 = origin.lat * DEG2RAD;
  const λ1 = origin.lng * DEG2RAD;

  const sinφ2 =
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * sinφ2,
    );

  let lng = λ2 * RAD2DEG;
  // normalize lng to [-180, 180)
  lng = ((lng + 540) % 360) - 180;
  return { lat: φ2 * RAD2DEG, lng };
}
