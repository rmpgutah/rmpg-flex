import { describe, it, expect } from 'vitest';
import { routeCrossesExclusionZone } from '../src/utils/navExclusionZones';

const squareZone = {
  id: 1,
  geojsonData: JSON.stringify({
    type: 'Polygon',
    coordinates: [[[-111.90, 40.75], [-111.88, 40.75], [-111.88, 40.77], [-111.90, 40.77], [-111.90, 40.75]]],
  }),
};

describe('routeCrossesExclusionZone', () => {
  it('detects a route point inside the exclusion polygon', () => {
    const route = [{ lng: -111.89, lat: 40.76 }];
    expect(routeCrossesExclusionZone(route, [squareZone])).toBe(true);
  });
  it('returns false when no route point falls inside any zone', () => {
    const route = [{ lng: -111.80, lat: 40.60 }];
    expect(routeCrossesExclusionZone(route, [squareZone])).toBe(false);
  });
  it('returns false with no zones', () => {
    const route = [{ lng: -111.89, lat: 40.76 }];
    expect(routeCrossesExclusionZone(route, [])).toBe(false);
  });
});
