import { describe, it, expect } from 'vitest';
import { parseZoneFeatures, pointInAnyPolygon, diffZoneMembership, type ParsedZone } from '../src/utils/geofenceZones';

const squareZone: ParsedZone = {
  polygons: [[[
    [-112.0, 40.0], [-111.0, 40.0], [-111.0, 41.0], [-112.0, 41.0], [-112.0, 40.0],
  ]]],
};

describe('parseZoneFeatures', () => {
  it('parses a FeatureCollection of Polygon features (draw-tool shape)', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: squareZone.polygons[0] }, properties: {} },
      ],
    });
    const parsed = parseZoneFeatures(geojson);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].polygons[0][0]).toHaveLength(5);
  });

  it('returns an empty array for invalid JSON instead of throwing', () => {
    expect(parseZoneFeatures('not json')).toEqual([]);
  });

  it('returns an empty array for a FeatureCollection with no polygon features', () => {
    const geojson = JSON.stringify({ type: 'FeatureCollection', features: [] });
    expect(parseZoneFeatures(geojson)).toEqual([]);
  });
});

describe('pointInAnyPolygon', () => {
  it('detects a point inside the polygon', () => {
    expect(pointInAnyPolygon(-111.5, 40.5, squareZone.polygons)).toBe(true);
  });

  it('detects a point outside the polygon', () => {
    expect(pointInAnyPolygon(-105.0, 40.5, squareZone.polygons)).toBe(false);
  });
});

describe('diffZoneMembership', () => {
  it('emits an enter event when a unit newly enters a zone', () => {
    const result = diffZoneMembership(null, 5);
    expect(result).toEqual({ type: 'enter', zoneId: 5 });
  });

  it('emits an exit event when a unit leaves its previous zone with no new zone', () => {
    const result = diffZoneMembership(5, null);
    expect(result).toEqual({ type: 'exit', zoneId: 5 });
  });

  it('emits enter+exit when a unit moves directly from one zone to another', () => {
    const result = diffZoneMembership(5, 7);
    expect(result).toEqual({ type: 'transfer', exitedZoneId: 5, enteredZoneId: 7 });
  });

  it('emits nothing when zone membership is unchanged', () => {
    expect(diffZoneMembership(5, 5)).toBeNull();
    expect(diffZoneMembership(null, null)).toBeNull();
  });
});
