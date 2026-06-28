import { describe, it, expect } from 'vitest';
import { daysCutoffISO, finiteCoord, geoFeature } from '../src/utils/intelGeo';

describe('intelGeo helpers', () => {
  it('finiteCoord accepts finite pairs, rejects junk', () => {
    expect(finiteCoord(40.7, -111.9)).toBe(true);
    expect(finiteCoord(null, -111.9)).toBe(false);
    expect(finiteCoord(40.7, NaN)).toBe(false);
    expect(finiteCoord(0, 0)).toBe(false); // null island → treat as missing
  });
  it('daysCutoffISO returns an ISO date N days before the given now', () => {
    expect(daysCutoffISO(7, new Date('2026-06-14T00:00:00Z'))).toBe('2026-06-07');
  });
  it('geoFeature shapes a typed feature with numeric coords', () => {
    expect(geoFeature('vehicle', 12, '40.70', '-111.90', 'ABC123', { when: '2026-06-10' }))
      .toEqual({ entity_type: 'vehicle', entity_id: 12, lat: 40.7, lng: -111.9, label: 'ABC123', when: '2026-06-10' });
  });
});
