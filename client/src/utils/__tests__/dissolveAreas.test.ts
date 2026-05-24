import { describe, expect, it } from 'vitest';
import { dissolveBeatsByArea } from '../dissolveAreas';
import type { Feature, Polygon } from 'geojson';

const beat = (id: string, coords: number[][][]): Feature<Polygon> => ({
  type: 'Feature',
  properties: { beat_code: id },
  geometry: { type: 'Polygon', coordinates: coords },
});

// 2x2 grid: A1, A2 share area=1 (left); B1, B2 share area=2 (right)
const fixture: Feature<Polygon>[] = [
  beat('A1', [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]),
  beat('A2', [[[0, 1], [1, 1], [1, 2], [0, 2], [0, 1]]]),
  beat('B1', [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]]),
  beat('B2', [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]]),
];
const beatToArea = new Map<string, number>([
  ['A1', 1], ['A2', 1], ['B1', 2], ['B2', 2],
]);

describe('dissolveBeatsByArea', () => {
  it('produces one boundary linestring per area (2 areas → 2 boundaries)', () => {
    const lines = dissolveBeatsByArea(fixture, beatToArea);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.geometry.type === 'LineString')).toBe(true);
  });

  it('excludes beats with no area_id from the dissolve', () => {
    const partial = new Map<string, number>([['A1', 1], ['A2', 1]]);
    const lines = dissolveBeatsByArea(fixture, partial);
    expect(lines).toHaveLength(1);
  });

  it('returns one outer-boundary linestring when all beats share an area', () => {
    const allSame = new Map<string, number>([['A1', 1], ['A2', 1], ['B1', 1], ['B2', 1]]);
    const lines = dissolveBeatsByArea(fixture, allSame);
    expect(lines).toHaveLength(1);
  });
});
