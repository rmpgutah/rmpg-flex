import { describe, it, expect } from 'vitest';
import { buildUnitMarkerEl, buildUnitPopupHtml, buildCallMarkerEl, buildCallPopupHtml } from '../mapMarkers';
import { TACTICAL_SURFACE_RAISED, TACTICAL_BRAND_GOLD, TACTICAL_TEXT_PRIMARY } from '../tacticalPalette';
import type { MapUnit, ActiveCall } from '../mapConstants';

const unit: MapUnit = {
  id: 'u1', call_sign: 'A12', officer_name: 'J. Smith', status: 'available',
  vehicle: '', current_call_type: null, current_call_location: null, call_number: null,
  latitude: 40.76, longitude: -111.89,
} as MapUnit;

const call: ActiveCall = {
  id: 'c1', call_number: 'CFS-1', incident_type: 'welfare_check', priority: '1',
  status: 'dispatched', location_address: '123 Main St', cross_street: null,
  beat_name: null, latitude: 40.76, longitude: -111.89,
} as ActiveCall;

describe('mapMarkers', () => {
  it('builds a unit marker element with the call sign text', () => {
    const el = buildUnitMarkerEl(unit);
    expect(el.textContent).toBe('A12');
    expect(el.className).toBe('rmpg-mbx-unit');
  });

  it('builds unit popup HTML containing the officer name', () => {
    expect(buildUnitPopupHtml(unit)).toContain('J. Smith');
  });

  it('builds a call marker element with the priority label', () => {
    const el = buildCallMarkerEl(call);
    expect(el.textContent).toBe('P1');
  });

  it('builds call popup HTML containing the call number', () => {
    expect(buildCallPopupHtml(call)).toContain('CFS-1');
  });

  it('unit popup HTML uses the tactical palette surface color, not a bare literal', () => {
    const html = buildUnitPopupHtml(unit);
    expect(html).toContain(TACTICAL_SURFACE_RAISED);
    expect(html).toContain(TACTICAL_BRAND_GOLD);
    expect(html).toContain(TACTICAL_TEXT_PRIMARY);
  });
});
