import { describe, it, expect } from 'vitest';
import {
  lngLatToTile, tileExtentToLngLat, pointToSegmentMeters, neighborTiles,
} from '../src/utils/osm/tileGeometry';

describe('lngLatToTile', () => {
  it('maps 0,0 to the middle of the z1 grid', () => {
    expect(lngLatToTile(0, 0, 1)).toEqual({ x: 1, y: 1 });
  });
  it('maps downtown Salt Lake City to its known z13 tile', () => {
    // 40.7608 N, 111.8910 W
    expect(lngLatToTile(-111.891, 40.7608, 13)).toEqual({ x: 1549, y: 3078 });
  });
});

describe('tileExtentToLngLat', () => {
  it('round-trips the tile origin back to a lng/lat inside that tile', () => {
    const z = 13, x = 1549, y = 3078;
    const { lng, lat } = tileExtentToLngLat(x, y, z, 0, 0, 4096);
    expect(lngLatToTile(lng, lat, z)).toEqual({ x, y });
  });
  it('places extent-center near the tile center', () => {
    const z = 13, x = 1549, y = 3078;
    const c = tileExtentToLngLat(x, y, z, 2048, 2048, 4096);
    const o = tileExtentToLngLat(x, y, z, 0, 0, 4096);
    expect(c.lng).toBeGreaterThan(o.lng);
    expect(c.lat).toBeLessThan(o.lat); // y grows southward
  });
});

describe('pointToSegmentMeters', () => {
  it('returns ~0 for a point on the segment', () => {
    expect(pointToSegmentMeters(0, 0, -1, 0, 1, 0)).toBeLessThan(1);
  });
  it('measures perpendicular distance to the segment body', () => {
    // 0.001 deg latitude is ~111 m.
    const d = pointToSegmentMeters(0, 0.001, -1, 0, 1, 0);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
  it('clamps to the nearer endpoint when the point is beyond the segment', () => {
    // Point is well past B; distance must be to B, not to the infinite line.
    const d = pointToSegmentMeters(2, 0, -1, 0, 1, 0);
    expect(d).toBeGreaterThan(100_000);
  });
  it('handles a degenerate zero-length segment without dividing by zero', () => {
    const d = pointToSegmentMeters(0, 0, 1, 0, 1, 0);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(100_000);
  });
});

describe('neighborTiles', () => {
  it('returns the 8 surrounding tiles plus none of the center', () => {
    const n = neighborTiles(10, 10, 13);
    expect(n).toHaveLength(8);
    expect(n).not.toContainEqual({ x: 10, y: 10 });
    expect(n).toContainEqual({ x: 9, y: 9 });
    expect(n).toContainEqual({ x: 11, y: 11 });
  });
  it('drops neighbours that fall outside the tile pyramid', () => {
    // At z1 the grid is 2x2, so the corner tile has only 3 valid neighbours.
    expect(neighborTiles(0, 0, 1)).toHaveLength(3);
  });
});
