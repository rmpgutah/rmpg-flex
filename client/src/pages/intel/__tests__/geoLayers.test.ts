import { describe, it, expect } from 'vitest';
import { LAYER_DEFS, toGeoJSON } from '../map/geoLayers';

describe('geoLayers', () => {
  it('has a def per layer key with a hex color', () => {
    expect(LAYER_DEFS.map((l) => l.key)).toContain('sightings');
    expect(LAYER_DEFS.every((l) => /^#[0-9a-fA-F]{3,8}$/.test(l.color))).toBe(true);
  });
  it('builds a FeatureCollection with [lng,lat] coords', () => {
    const fc = toGeoJSON([{ entity_type: 'vehicle', entity_id: 1, lat: 40.7, lng: -111.9, label: 'X' }]);
    expect(fc.features[0].geometry.coordinates).toEqual([-111.9, 40.7]);
    expect(fc.features[0].properties.label).toBe('X');
    expect(fc.features[0].properties.entity_id).toBe(1);
  });
});
