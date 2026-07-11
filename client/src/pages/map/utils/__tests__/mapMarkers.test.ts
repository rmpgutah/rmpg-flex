import { describe, it, expect } from 'vitest';
import { buildUnitMarkerEl, applyUnitMarkerState, buildUnitPopupHtml, buildCallMarkerEl, buildCallPopupHtml } from '../mapMarkers';
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

  it('dims and dashes a unit marker once its GPS fix goes stale/lost', () => {
    const fresh = buildUnitMarkerEl({ ...unit, gps_updated_at: new Date().toISOString() } as MapUnit);
    expect(fresh.style.opacity).toBe('1');

    const staleTs = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const stale = buildUnitMarkerEl({ ...unit, gps_updated_at: staleTs } as MapUnit);
    expect(stale.style.opacity).toBe('0.7');
    expect(stale.title).toContain('GPS stale');

    const lostTs = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const lost = buildUnitMarkerEl({ ...unit, gps_updated_at: lostTs } as MapUnit);
    expect(lost.style.opacity).toBe('0.45');
    expect(lost.title).toContain('GPS lost');
  });

  it('applyUnitMarkerState updates an existing marker element without destroying its children', () => {
    const el = buildUnitMarkerEl(unit);
    const photoFrameBefore = el.querySelector('[data-role="photo-frame"]');
    const labelBefore = el.querySelector('[data-role="label"]');
    expect(photoFrameBefore).not.toBeNull();
    expect(labelBefore).not.toBeNull();

    applyUnitMarkerState(el, { ...unit, call_sign: 'B99', status: 'dispatched' } as MapUnit);

    // Same DOM node identity — this is the whole point of the fix.
    expect(el.querySelector('[data-role="photo-frame"]')).toBe(photoFrameBefore);
    expect(el.querySelector('[data-role="label"]')).toBe(labelBefore);
    expect(el.querySelector('[data-role="label"]')?.textContent).toBe('B99');
  });
});
