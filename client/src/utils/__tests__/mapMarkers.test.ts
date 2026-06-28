import { describe, it, expect } from 'vitest';
import {
  buildUnitMarker,
  buildCallMarker,
  buildDotMarker,
  unitStatusColor,
  callPriorityColor,
  isValidLngLat,
} from '../mapMarkers';

describe('unitStatusColor', () => {
  it('maps known statuses to theme colors', () => {
    expect(unitStatusColor('in_service')).toBe('#22c55e');
    expect(unitStatusColor('busy')).toBe('#d4a017');
    expect(unitStatusColor('enroute')).toBe('#d4a017');
    expect(unitStatusColor('out_of_service')).toBe('#888888');
  });
  it('falls back to neutral for unknown status', () => {
    expect(unitStatusColor('banana' as never)).toBe('#888888');
    expect(unitStatusColor(undefined)).toBe('#888888');
  });
});

describe('callPriorityColor', () => {
  it('maps high priority to red, low to neutral', () => {
    expect(callPriorityColor(1)).toBe('#dc2626');
    expect(callPriorityColor('1')).toBe('#dc2626');
    expect(callPriorityColor(9)).toBe('#888888');
  });
  it('falls back to gold for unknown priority', () => {
    expect(callPriorityColor(undefined)).toBe('#d4a017');
  });
});

describe('buildUnitMarker', () => {
  it('returns an HTMLElement with the status ring color and label text', () => {
    const el = buildUnitMarker({ label: '12', status: 'in_service' });
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.textContent).toContain('12');
    expect(el.outerHTML).toContain('#22c55e');
  });
  it('does not use innerHTML injection for the label (text is escaped)', () => {
    const el = buildUnitMarker({ label: '<img src=x>', status: 'busy' });
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x>');
  });
});

describe('buildCallMarker', () => {
  it('returns an HTMLElement colored by priority', () => {
    const el = buildCallMarker({ priority: 1 });
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.outerHTML).toContain('#dc2626');
  });
});

describe('buildDotMarker', () => {
  it('returns a colored dot element', () => {
    const el = buildDotMarker({ color: '#d4a017', size: 12 });
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.style.background).toContain('rgb(212, 160, 23)');
  });
});

describe('isValidLngLat', () => {
  it('accepts a real Utah position', () => {
    expect(isValidLngLat(-111.876, 40.760)).toBe(true);
  });
  it('rejects the exact (0, 0) ClearPath no-fix signature', () => {
    expect(isValidLngLat(0, 0)).toBe(false);
  });
  it('accepts coordinates close to but not exactly (0, 0)', () => {
    // Real Utah positions have >=4 significant digits; the rejection is intentionally exact.
    expect(isValidLngLat(0.0001, 0.0001)).toBe(true);
    expect(isValidLngLat(0, 0.0001)).toBe(true);
    expect(isValidLngLat(0.0001, 0)).toBe(true);
  });
  it('rejects NaN / Infinity / -Infinity', () => {
    expect(isValidLngLat(NaN, 40)).toBe(false);
    expect(isValidLngLat(-111, NaN)).toBe(false);
    expect(isValidLngLat(Infinity, 40)).toBe(false);
    expect(isValidLngLat(-Infinity, 40)).toBe(false);
    expect(isValidLngLat(-111, Infinity)).toBe(false);
  });
  it('rejects null / undefined / non-number types', () => {
    expect(isValidLngLat(null, 40)).toBe(false);
    expect(isValidLngLat(-111, null)).toBe(false);
    expect(isValidLngLat(undefined, undefined)).toBe(false);
    expect(isValidLngLat('-111', 40)).toBe(false);
    expect(isValidLngLat(-111, '40')).toBe(false);
  });
  it('rejects out-of-globe values', () => {
    expect(isValidLngLat(-111, 91)).toBe(false);
    expect(isValidLngLat(-111, -91)).toBe(false);
    expect(isValidLngLat(181, 40)).toBe(false);
    expect(isValidLngLat(-181, 40)).toBe(false);
  });
});
