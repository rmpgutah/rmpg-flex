import { describe, it, expect } from 'vitest';
import { parseZoneFeatures, pointInAnyPolygon, diffZoneMembership } from '../src/utils/geofenceZones';

// Integration-style test: composes the three geofenceZones.ts primitives the
// same way src/routes/dispatch/gps.ts does on every GPS ingest, using a
// GeoJSON FeatureCollection shaped exactly like what mapbox-gl-draw's
// `draw.getAll()` produces in DrawGeofenceTool.tsx (client/src/pages/map/
// components/DrawGeofenceTool.tsx:60) before it's JSON.stringify'd into
// geofence_zones.geojson_data (DrawGeofenceTool.tsx:71). The point is to
// catch a schema mismatch between what the draw tool actually saves
// (mapbox-gl-draw injects an `id` and non-empty `properties` per feature)
// and what parseZoneFeatures expects.
function mapboxDrawFeatureCollection(coordinates: number[][][]) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        id: 'a1b2c3d4e5f6g7h8i9j0', // mapbox-gl-draw assigns a random string id
        type: 'Feature',
        properties: {}, // mapbox-gl-draw always includes a (possibly empty) properties object
        geometry: {
          type: 'Polygon',
          coordinates,
        },
      },
    ],
  });
}

// A patrol-required zone roughly covering downtown Salt Lake City.
const DOWNTOWN_SLC_RING: number[][] = [
  [-111.90, 40.75],
  [-111.87, 40.75],
  [-111.87, 40.77],
  [-111.90, 40.77],
  [-111.90, 40.75],
];

// A disjoint exclusion zone west of downtown.
const WEST_ZONE_RING: number[][] = [
  [-112.05, 40.75],
  [-112.02, 40.75],
  [-112.02, 40.77],
  [-112.05, 40.77],
  [-112.05, 40.75],
];

describe('geofence entry/exit detection (integration)', () => {
  it('parses a real mapbox-gl-draw FeatureCollection (id + properties present) into a polygon zone', () => {
    const geojson = mapboxDrawFeatureCollection([DOWNTOWN_SLC_RING]);
    const parsed = parseZoneFeatures(geojson);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].polygons).toHaveLength(1);
    expect(parsed[0].polygons[0][0]).toEqual(DOWNTOWN_SLC_RING);
  });

  it('detects a GPS fix inside a saved zone and emits an enter transition on the first sighting', () => {
    const zone = { id: 42, geojson_data: mapboxDrawFeatureCollection([DOWNTOWN_SLC_RING]) };
    const parsedZones = parseZoneFeatures(zone.geojson_data);

    // A fix comfortably inside the drawn ring.
    const lat = 40.76;
    const lng = -111.885;
    const inside = parsedZones.some((pz) => pointInAnyPolygon(lng, lat, pz.polygons));
    expect(inside).toBe(true);

    const currentZoneId = inside ? zone.id : null;
    const priorZoneId: number | null = null; // unit had no prior geofence_state row
    const transition = diffZoneMembership(priorZoneId, currentZoneId);
    expect(transition).toEqual({ type: 'enter', zoneId: 42 });
  });

  it('emits an exit transition once a unit leaves the zone it was previously in', () => {
    const zone = { id: 42, geojson_data: mapboxDrawFeatureCollection([DOWNTOWN_SLC_RING]) };
    const parsedZones = parseZoneFeatures(zone.geojson_data);

    // A fix well outside the ring (out past the west edge).
    const lat = 40.76;
    const lng = -111.5;
    const inside = parsedZones.some((pz) => pointInAnyPolygon(lng, lat, pz.polygons));
    expect(inside).toBe(false);

    const currentZoneId = inside ? zone.id : null;
    const priorZoneId = 42; // unit_geofence_state had this unit inside zone 42
    const transition = diffZoneMembership(priorZoneId, currentZoneId);
    expect(transition).toEqual({ type: 'exit', zoneId: 42 });
  });

  it('emits a transfer when a unit moves directly from one drawn zone into a disjoint second zone', () => {
    const zoneA = { id: 1, geojson_data: mapboxDrawFeatureCollection([DOWNTOWN_SLC_RING]) };
    const zoneB = { id: 2, geojson_data: mapboxDrawFeatureCollection([WEST_ZONE_RING]) };
    const zones = [zoneA, zoneB];

    // A fix inside the west zone only.
    const lat = 40.76;
    const lng = -112.035;

    let currentZoneId: number | null = null;
    for (const zone of zones) {
      const parsedZones = parseZoneFeatures(zone.geojson_data);
      const inside = parsedZones.some((pz) => pointInAnyPolygon(lng, lat, pz.polygons));
      if (inside) {
        currentZoneId = zone.id;
        break; // first match wins, mirroring gps.ts
      }
    }
    expect(currentZoneId).toBe(2);

    const priorZoneId = 1; // unit was previously inside downtown zone
    const transition = diffZoneMembership(priorZoneId, currentZoneId);
    expect(transition).toEqual({ type: 'transfer', exitedZoneId: 1, enteredZoneId: 2 });
  });

  it('is a no-op when a unit stays inside the same zone across consecutive fixes', () => {
    const zone = { id: 42, geojson_data: mapboxDrawFeatureCollection([DOWNTOWN_SLC_RING]) };
    const parsedZones = parseZoneFeatures(zone.geojson_data);
    const inside = parsedZones.some((pz) => pointInAnyPolygon(-111.885, 40.76, pz.polygons));
    const currentZoneId = inside ? zone.id : null;
    const transition = diffZoneMembership(42, currentZoneId);
    expect(transition).toBeNull();
  });

  it('handles a MultiPolygon geometry (disjoint shapes drawn as one zone) the same way as separate Polygon features', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          id: 'multi1',
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'MultiPolygon',
            coordinates: [[DOWNTOWN_SLC_RING], [WEST_ZONE_RING]],
          },
        },
      ],
    });
    const parsedZones = parseZoneFeatures(geojson);
    expect(parsedZones).toHaveLength(1);
    // A fix inside either disjoint shape should register as inside the zone.
    expect(parsedZones.some((pz) => pointInAnyPolygon(-111.885, 40.76, pz.polygons))).toBe(true);
    expect(parsedZones.some((pz) => pointInAnyPolygon(-112.035, 40.76, pz.polygons))).toBe(true);
    expect(parsedZones.some((pz) => pointInAnyPolygon(-111.5, 40.76, pz.polygons))).toBe(false);
  });
});
