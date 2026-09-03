import { describe, it, expect } from 'vitest';
// @ts-expect-error - untyped .mjs module
import { conePolygon, coneFeature, coneFeatures } from '../scripts/osm/cones.mjs';

const ORIGIN: [number, number] = [-111.891, 40.7608]; // Salt Lake City

describe('conePolygon', () => {
  it('returns a closed Polygon ring starting and ending at the apex', () => {
    const g = conePolygon(ORIGIN[0], ORIGIN[1], 0);
    expect(g.type).toBe('Polygon');
    const ring = g.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring[0][0]).toBeCloseTo(ORIGIN[0], 10);
    expect(ring[0][1]).toBeCloseTo(ORIGIN[1], 10);
  });

  it('points NORTH for bearing 0 (latitude increases, longitude ~unchanged)', () => {
    const ring = conePolygon(ORIGIN[0], ORIGIN[1], 0).coordinates[0];
    // Midpoint of the arc is the centerline.
    const mid = ring[Math.floor(ring.length / 2)];
    expect(mid[1]).toBeGreaterThan(ORIGIN[1]);
    expect(mid[0]).toBeCloseTo(ORIGIN[0], 3);
  });

  it('points EAST for bearing 90 (longitude increases, latitude ~unchanged)', () => {
    const ring = conePolygon(ORIGIN[0], ORIGIN[1], 90).coordinates[0];
    const mid = ring[Math.floor(ring.length / 2)];
    expect(mid[0]).toBeGreaterThan(ORIGIN[0]);
    expect(mid[1]).toBeCloseTo(ORIGIN[1], 3);
  });

  it('points SOUTH for bearing 180', () => {
    const ring = conePolygon(ORIGIN[0], ORIGIN[1], 180).coordinates[0];
    const mid = ring[Math.floor(ring.length / 2)];
    expect(mid[1]).toBeLessThan(ORIGIN[1]);
  });

  it('points WEST for bearing 270', () => {
    const ring = conePolygon(ORIGIN[0], ORIGIN[1], 270).coordinates[0];
    const mid = ring[Math.floor(ring.length / 2)];
    expect(mid[0]).toBeLessThan(ORIGIN[0]);
  });

  it('respects the radius — a 30 m cone stays well under 0.001 degrees latitude', () => {
    const ring = conePolygon(ORIGIN[0], ORIGIN[1], 0, 30).coordinates[0];
    const mid = ring[Math.floor(ring.length / 2)];
    // 30 m ≈ 0.00027 degrees latitude.
    expect(mid[1] - ORIGIN[1]).toBeGreaterThan(0.0002);
    expect(mid[1] - ORIGIN[1]).toBeLessThan(0.0004);
  });

  it('scales longitude by 1/cos(latitude) — an east cone must be wider (in degrees) than a north cone', () => {
    // At 40.7608°N, cos(lat) ≈ 0.7566, so the east-pointing cone's longitude
    // delta should be about 1/0.7566 ≈ 1.32x the north-pointing cone's latitude
    // delta. A toBeCloseTo(…, 3) tolerance (0.001) is wider than the entire
    // ~0.00027-degree cone, so it can't catch a removed cos() scaling — assert
    // the ratio directly instead.
    const north = conePolygon(ORIGIN[0], ORIGIN[1], 0);
    const east = conePolygon(ORIGIN[0], ORIGIN[1], 90);
    const northMid = north.coordinates[0][Math.floor(north.coordinates[0].length / 2)];
    const eastMid = east.coordinates[0][Math.floor(east.coordinates[0].length / 2)];

    const dLatNorth = northMid[1] - ORIGIN[1];
    const dLngEast = eastMid[0] - ORIGIN[0];

    const expectedRatio = 1 / Math.cos((ORIGIN[1] * Math.PI) / 180);
    const actualRatio = dLngEast / dLatNorth;

    expect(actualRatio).toBeGreaterThan(expectedRatio * 0.97);
    expect(actualRatio).toBeLessThan(expectedRatio * 1.03);
  });

  it('produces segments+2 ring points (apex, arc, closing apex)', () => {
    const ring = conePolygon(ORIGIN[0], ORIGIN[1], 0, 30, 60, 12).coordinates[0];
    expect(ring).toHaveLength(12 + 1 + 2);
  });
});

describe('coneFeature', () => {
  const cam = (props: Record<string, string>) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: ORIGIN },
    properties: props,
  });

  it('builds a cone feature tagged camera_cone', () => {
    const f = coneFeature(cam({ cat: 'camera', 'camera:direction': '45' }))!;
    expect(f.properties.cat).toBe('camera_cone');
    expect(f.geometry.type).toBe('Polygon');
  });

  it('carries the parent category through so ALPR cones can be styled apart', () => {
    const f = coneFeature(cam({ cat: 'alpr', 'camera:direction': '45' }))!;
    expect(f.properties.parent_cat).toBe('alpr');
  });

  it('returns null when camera:direction is absent', () => {
    expect(coneFeature(cam({ cat: 'camera' }))).toBeNull();
  });

  it('returns null when camera:direction is not a number', () => {
    expect(coneFeature(cam({ cat: 'camera', 'camera:direction': 'north-ish' }))).toBeNull();
  });

  it('accepts a cardinal-free numeric string with whitespace', () => {
    expect(coneFeature(cam({ cat: 'camera', 'camera:direction': ' 180 ' }))).not.toBeNull();
  });

  it('accepts OSM cardinals (NE) rather than dropping them', () => {
    const f = coneFeature(cam({ cat: 'camera', 'camera:direction': 'NE' }))!;
    expect(f).not.toBeNull();
    expect(f.properties['camera:bearing']).toBe('45');
  });

  it('does not invent a wedge for a dome housing', () => {
    expect(coneFeature(cam({ cat: 'camera', 'camera:type': 'dome', 'camera:direction': '90' }))).toBeNull();
  });

  it('emits one wedge per look-direction on a semicolon list', () => {
    const many = coneFeatures(cam({ cat: 'alpr', 'camera:direction': '45;225' }));
    expect(many).toHaveLength(2);
    expect(many[0].properties.parent_cat).toBe('alpr');
  });

  it('uses a longer narrower default for ALPR than for public CCTV', () => {
    const alpr = coneFeature(cam({ cat: 'alpr', 'camera:direction': '90' }))!;
    const cctv = coneFeature(cam({ cat: 'camera', 'camera:direction': '90' }))!;
    expect(Number(alpr.properties.cone_radius_m)).toBeGreaterThan(Number(cctv.properties.cone_radius_m));
    expect(Number(alpr.properties.cone_fov_deg)).toBeLessThan(Number(cctv.properties.cone_fov_deg));
  });

  it('returns null for a non-point geometry', () => {
    const way = {
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: [ORIGIN, ORIGIN] },
      properties: { cat: 'camera', 'camera:direction': '45' },
    };
    expect(coneFeature(way as any)).toBeNull();
  });
});
