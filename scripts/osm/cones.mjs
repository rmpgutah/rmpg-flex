// Camera view-cone geometry, generated at BUILD time.
//
// Why build-time: Mapbox GL cannot construct geometry in a paint/layout
// expression, and a client-side turf pass over a streaming vector source has no
// stable feature set to operate on. The cone is a real polygon feature in the
// archive, tagged cat=camera_cone.

const M_PER_DEG_LAT = 111_320;

/**
 * Wedge polygon centered on `bearingDeg`.
 *
 * OSM camera:direction is degrees CLOCKWISE FROM NORTH. Math angles are
 * counter-clockwise from EAST. mathDeg = 90 - bearingDeg. Reversing this
 * mirrors every cone across the N-S axis — plausible-looking and wrong.
 */
export function conePolygon(lng, lat, bearingDeg, radiusM = 30, arcDeg = 60, segments = 12) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / (mPerDegLng || 1);

  const centerMath = 90 - bearingDeg;
  const start = centerMath - arcDeg / 2;
  const step = arcDeg / segments;

  const ring = [[lng, lat]];
  for (let i = 0; i <= segments; i++) {
    const rad = ((start + i * step) * Math.PI) / 180;
    ring.push([lng + Math.cos(rad) * dLng, lat + Math.sin(rad) * dLat]);
  }
  ring.push([lng, lat]);

  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * Cone feature for a projected camera point, or null when the bearing is
 * missing/unparseable or the geometry is not a point. A missing cone means
 * "bearing unknown" — never "omnidirectional".
 */
export function coneFeature(feature, catValue = 'camera_cone') {
  if (!feature || feature.geometry?.type !== 'Point') return null;
  const raw = feature.properties?.['camera:direction'];
  if (raw === undefined || raw === null) return null;

  const bearing = Number(String(raw).trim());
  if (!Number.isFinite(bearing)) return null;

  const [lng, lat] = feature.geometry.coordinates;
  return {
    type: 'Feature',
    geometry: conePolygon(lng, lat, bearing),
    properties: { cat: catValue, parent_cat: feature.properties.cat ?? null },
  };
}
