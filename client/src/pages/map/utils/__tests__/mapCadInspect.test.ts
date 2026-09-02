import { describe, it, expect } from 'vitest';
import { collectCadGeoFeatures, collectCadMarkers, cadDetailRows, isCadGeoLayer } from '../mapCadInspect';

describe('mapCadInspect', () => {
  it('recognizes beat, district, and coverage layers', () => {
    expect(isCadGeoLayer('geojson-beat-fill')).toBe(true);
    expect(isCadGeoLayer('dh-sector-fill')).toBe(true);
    expect(isCadGeoLayer('beat-coverage-fill')).toBe(true);
    expect(isCadGeoLayer('rmpg-serve-jobs-source-circle')).toBe(true);
    expect(isCadGeoLayer('vt-osm_safety_hydrant-circle')).toBe(false);
  });

  it('collects a beat fill and skips the duplicate line', () => {
    const hits = collectCadGeoFeatures([
      { layer: { id: 'geojson-beat-fill' }, properties: { beat_code: 'SL2' }, geometry: { type: 'Polygon', coordinates: [] } },
      { layer: { id: 'geojson-beat-line' }, properties: { beat_code: 'SL2' }, geometry: { type: 'LineString', coordinates: [] } },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].categoryLabel).toBe('Beat');
    expect(hits[0].kind).toBe('cad');
    expect(hits[0].properties.__cad_title).toBe('SL2');
  });

  it('hits a unit inside the pixel tolerance', () => {
    const project = (lng: number, lat: number) => ({
      x: lng === -111.89 ? 400 : 900,
      y: lat === 40.76 ? 300 : 900,
    });
    const units = [{
      id: 'u1', call_sign: '1A12', officer_name: 'Hale', status: 'available',
      latitude: 40.76, longitude: -111.89,
    }];
    const hits = collectCadMarkers(units, [], project, { x: 404, y: 302 }, 8);
    expect(hits).toHaveLength(1);
    expect(hits[0].cadKind).toBe('unit');
    expect(cadDetailRows(hits[0]).map((r) => r.label)).toContain('Officer');
  });

  it('ignores a unit outside the pixel box', () => {
    const project = () => ({ x: 10, y: 10 });
    const units = [{
      id: 'u1', call_sign: '1A12', officer_name: 'Hale', status: 'available',
      latitude: 40.76, longitude: -111.89,
    }];
    expect(collectCadMarkers(units, [], project, { x: 400, y: 300 }, 8)).toHaveLength(0);
  });
});
