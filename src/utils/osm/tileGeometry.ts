// ============================================================
// RMPG Flex — Web-Mercator tile maths for the OSM point lookup
// ============================================================
// Pure functions only — no I/O, no R2, no MVT decoding. Keeping the maths
// here is what lets the nearest-way search be unit-tested without building
// a fixture PMTiles archive.
// ============================================================

const EARTH_RADIUS_M = 6371000;

/** Which XYZ tile contains this coordinate at the given zoom. */
export function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  // Clamp so a lat/lng at the very edge of the projection can't index past the
  // grid — callers use this to build R2 keys, and an out-of-range tile 400s.
  const max = n - 1;
  return {
    x: Math.min(max, Math.max(0, x)),
    y: Math.min(max, Math.max(0, y)),
  };
}

/**
 * Convert an MVT-local coordinate (0..extent within tile x/y/z) back to lng/lat.
 * MVT y grows southward, matching XYZ tile y.
 */
export function tileExtentToLngLat(
  x: number, y: number, z: number, px: number, py: number, extent: number,
): { lng: number; lat: number } {
  const n = 2 ** z;
  const worldX = x + px / extent;
  const worldY = y + py / extent;
  const lng = (worldX / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * worldY) / n)));
  return { lng, lat: (latRad * 180) / Math.PI };
}

/**
 * Shortest distance in meters from a point to a line SEGMENT (not the infinite
 * line). Projects into a local equirectangular plane scaled by cos(lat), which
 * is accurate well past the ~1 km scale this lookup cares about and avoids the
 * cost of a full geodesic solve per segment.
 *
 * The segment clamp matters: a road's nearest point is frequently past an
 * endpoint, and an unclamped perpendicular would report a road as closer than
 * it is and pick the wrong speed limit.
 */
export function pointToSegmentMeters(
  pLng: number, pLat: number,
  aLng: number, aLat: number,
  bLng: number, bLat: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const cosLat = Math.cos(toRad(pLat));
  // Local plane in meters, origin at A.
  const px = toRad(pLng - aLng) * cosLat * EARTH_RADIUS_M;
  const py = toRad(pLat - aLat) * EARTH_RADIUS_M;
  const bx = toRad(bLng - aLng) * cosLat * EARTH_RADIUS_M;
  const by = toRad(bLat - aLat) * EARTH_RADIUS_M;

  const lenSq = bx * bx + by * by;
  // Degenerate segment (duplicate vertices are common in real tile data):
  // fall back to point-to-point rather than dividing by zero.
  if (lenSq === 0) return Math.hypot(px, py);

  let t = (px * bx + py * by) / lenSq;
  t = Math.max(0, Math.min(1, t)); // clamp to the segment
  return Math.hypot(px - t * bx, py - t * by);
}

/**
 * The up-to-8 tiles surrounding (x,y) at zoom z, dropping any that fall outside
 * the pyramid. A point near a tile edge can have its nearest road in the
 * neighbouring tile, so the lookup must consider these.
 */
export function neighborTiles(x: number, y: number, z: number): { x: number; y: number }[] {
  const n = 2 ** z;
  const out: { x: number; y: number }[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      out.push({ x: nx, y: ny });
    }
  }
  return out;
}
