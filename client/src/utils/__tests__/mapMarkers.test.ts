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
    // The marker's only innerHTML use is a static, developer-authored SVG
    // glyph (not user data); the label is set via textContent, so an
    // XSS-unsafe label would render a live <img> from the injected string —
    // assert none exists and the literal text is preserved as plain text.
    expect(el.querySelectorAll('img')).toHaveLength(0);
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

// ── Regression guard: mapboxgl-owned root element ────────────────────────
// Every element handed to `new mapboxgl.Marker({ element })` has its
// `style.transform` REWRITTEN IN FULL by Mapbox on every render frame during
// pan/zoom. Two consequences these tests pin:
//   1. a `transform` written on the root is destroyed (the teardrop's
//      rotate(-45deg) used to live here and rendered as a plain circle);
//   2. a `transition`/`animation` on `transform` turns each frame's reposition
//      into an animation the marker chases, so the pin visibly lags the map.
// All visual styling belongs on the inner [data-role="marker-inner"] wrapper.
describe('marker roots stay transform-free (pan/zoom drift guard)', () => {
  const ROOTS: Array<[string, () => HTMLElement]> = [
    ['buildUnitMarker', () => buildUnitMarker({ label: '12', status: 'in_service' })],
    ['buildCallMarker', () => buildCallMarker({ priority: 1, label: 'P1' })],
    ['buildDotMarker', () => buildDotMarker({ color: 'var(--field-label-color)', size: 12 })],
    ['buildDotMarker (pulsing)', () => buildDotMarker({ color: 'var(--field-label-color)', size: 12, pulse: true })],
  ];

  for (const [name, build] of ROOTS) {
    it(`${name} writes no transform on the root element`, () => {
      expect(build().style.transform).toBe('');
    });

    it(`${name} writes no transform transition on the root element`, () => {
      const { transition, animationName } = build().style;
      expect(transition).not.toContain('transform');
      // The only animation any of these roots may carry is the opacity-only
      // recovery pulse; a transform-animating keyframe would fight Mapbox.
      if (animationName) expect(animationName).toBe('rmpg-recovery-pulse');
    });
  }

  it('buildCallMarker keeps the teardrop rotation on the inner wrapper, where it survives', () => {
    const el = buildCallMarker({ priority: 1 });
    const inner = el.querySelector<HTMLElement>('[data-role="marker-inner"]');
    expect(inner).not.toBeNull();
    expect(inner!.style.transform).toContain('rotate(-45deg)');
    expect(inner!.style.borderRadius).toBe('50% 50% 50% 0');
  });
});

describe('buildDotMarker', () => {
  it('returns a colored dot element', () => {
    const el = buildDotMarker({ color: 'var(--field-label-color)', size: 12 });
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
