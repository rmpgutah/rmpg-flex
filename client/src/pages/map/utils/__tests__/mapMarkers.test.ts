import { describe, it, expect } from 'vitest';
import { buildUnitMarkerEl, applyUnitMarkerState, buildUnitPopupHtml, buildCallMarkerEl, buildCallPopupHtml, shouldAnimateMarkerMove, computeAccuracyRingGeometry, CALL_MARKER_INK } from '../mapMarkers';
import { TACTICAL_SURFACE_RAISED, TACTICAL_BRAND_GOLD, TACTICAL_TEXT_PRIMARY } from '../tacticalPalette';
import type { MapUnit, ActiveCall } from '../mapConstants';
import { PRIORITY_HEX, priorityHex } from '../../../../utils/statusColors';
import { MAP_PALETTE } from '../../../../utils/mapboxBasemap';

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
    // Opacity lives on the inner `[data-role="marker-inner"]` wrapper, not the
    // mapboxgl-controlled root element (see buildUnitMarkerEl).
    const getInnerOpacity = (el: HTMLElement) =>
      (el.querySelector('[data-role="marker-inner"]') as HTMLElement).style.opacity;

    const fresh = buildUnitMarkerEl({ ...unit, gps_updated_at: new Date().toISOString() } as MapUnit);
    expect(getInnerOpacity(fresh)).toBe('1');

    const staleTs = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const stale = buildUnitMarkerEl({ ...unit, gps_updated_at: staleTs } as MapUnit);
    expect(getInnerOpacity(stale)).toBe('0.7');
    expect(stale.title).toContain('GPS stale');

    const lostTs = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const lost = buildUnitMarkerEl({ ...unit, gps_updated_at: lostTs } as MapUnit);
    expect(getInnerOpacity(lost)).toBe('0.45');
    expect(lost.title).toContain('GPS lost');
  });

  it('applyUnitMarkerState updates an existing marker element without destroying its children', () => {
    const el = buildUnitMarkerEl(unit);
    const badgeBefore = el.querySelector('[data-role="badge"]');
    const labelBefore = el.querySelector('[data-role="label"]');
    expect(badgeBefore).not.toBeNull();
    expect(labelBefore).not.toBeNull();

    applyUnitMarkerState(el, { ...unit, call_sign: 'B99', status: 'dispatched' } as MapUnit);

    // Same DOM node identity — this is the whole point of the fix.
    expect(el.querySelector('[data-role="badge"]')).toBe(badgeBefore);
    expect(el.querySelector('[data-role="label"]')).toBe(labelBefore);
    expect(el.querySelector('[data-role="label"]')?.textContent).toBe('B99');
  });
});

function srgbC(c: number) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function lumOf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * srgbC((n >> 16) & 255) + 0.7152 * srgbC((n >> 8) & 255) + 0.0722 * srgbC(n & 255);
}
function ratio(a: string, b: string) {
  const [x, y] = [lumOf(a), lumOf(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// OKLCH lightness (Ottosson) — only the L channel is needed. Copied from
// chartTokens.test.ts's oklabL, which asserts the same ordinal-ramp property
// for the CSS --chart-pri-* ramps; PRIORITY_HEX comes from the same
// construction (see docs/superpowers/specs/2026-07-25-reports-chart-palette-design.md)
// so it should hold here too. Duplicated rather than exported from production
// code — it's a small pure test helper.
function oklabL(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [R, G, B] = [srgbC((n >> 16) & 255), srgbC((n >> 8) & 255), srgbC(n & 255)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
}

describe('map priority palette', () => {
  it('is raw 6-digit hex — the ${color}NN concat contract forbids var()', () => {
    for (const [k, v] of Object.entries(PRIORITY_HEX)) {
      expect(v, `${k} must be raw hex`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('clears 3:1 against the fixed map land', () => {
    for (const [k, v] of Object.entries(PRIORITY_HEX)) {
      expect(ratio(v, MAP_PALETTE.land), `${k} (${v}) on land`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the P{n} ink clears 4.5:1 against every priority fill', () => {
    for (const [k, v] of Object.entries(PRIORITY_HEX)) {
      expect(ratio(CALL_MARKER_INK, v), `ink on ${k} (${v})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is a monotone ordinal ramp, P1..P4 (same construction as the CSS --chart-pri-* ramps)', () => {
    const order: Array<keyof typeof PRIORITY_HEX> = ['P1', 'P2', 'P3', 'P4'];
    const Ls = order.map((k) => oklabL(PRIORITY_HEX[k]));
    const deltas = Ls.slice(1).map((L, i) => L - Ls[i]);
    // All steps move the same direction, and each gap clears the 0.06 ordinal floor.
    expect(deltas.every((d) => d < 0) || deltas.every((d) => d > 0), `ΔL ${deltas}`).toBe(true);
    for (const d of deltas) expect(Math.abs(d), `ΔL ${deltas}`).toBeGreaterThanOrEqual(0.06);
  });

  it('resolves both the "P1" and bare "1" key shapes', () => {
    expect(priorityHex('P1')).toBe(PRIORITY_HEX.P1);
    expect(priorityHex('1')).toBe(PRIORITY_HEX.P1);
    expect(priorityHex(4)).toBe(PRIORITY_HEX.P4);
    expect(priorityHex('nonsense')).toBe(PRIORITY_HEX.P4);
  });

  it('gives a call marker its real priority color, not the gray fallback', () => {
    // This fixture's ActiveCall.priority is a bare number string ('1') on
    // purpose, but that's NOT what production looks like: calls_for_service.priority
    // is DB-constrained to 'P1'..'P4' (migrations/0001_initial.sql) and the
    // dispatch queue route passes it through verbatim, so a plain 'P1'-keyed
    // PRIORITY_HEX lookup hits correctly on live data. The bare '1' shape does
    // show up elsewhere in this tree (this fixture, useAutoPanToP1.ts), so
    // priorityHex() is tolerant of both rather than trusting either — this test
    // guards that tolerance, not a real production miss.
    //
    // Reading it back via el.style.background doesn't work in this jsdom
    // version: cssstyle's parser has an unrelated quirk where the `background`
    // shorthand followed by certain longhands (border-radius, transform, ...)
    // in one cssText string silently voids the ENTIRE inline style — true of
    // buildCallMarkerEl's cssText regardless of this fix (reproduced with the
    // pre-existing #888888 fallback too), so el.style.* always reads back
    // empty here. Capture the string at assignment time instead, so the
    // regression check isn't defeated by that environment limitation.
    const proto = (globalThis as unknown as { CSSStyleDeclaration: { prototype: CSSStyleDeclaration } }).CSSStyleDeclaration.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'cssText')!;
    const captured: string[] = [];
    Object.defineProperty(proto, 'cssText', {
      configurable: true,
      get: descriptor.get,
      set(v: string) { captured.push(v); descriptor.set!.call(this, v); },
    });
    try {
      buildCallMarkerEl(call);
    } finally {
      Object.defineProperty(proto, 'cssText', descriptor);
    }
    const all = captured.join('\n');
    expect(all).toContain(`background:${PRIORITY_HEX.P1};`);
    expect(all).not.toContain('#888888');
  });
});

describe('call popup priority color', () => {
  it('uses the real priority color, not the gray fallback', () => {
    // buildCallPopupHtml had the same 'P1'-keyed lookup against a bare-number
    // priority that buildCallMarkerEl did, so it always emitted #888888.
    const html = buildCallPopupHtml(call);
    expect(html).toContain(PRIORITY_HEX.P1);
    expect(html).not.toContain('#888888');
  });
});

describe('shouldAnimateMarkerMove', () => {
  it('animates a normal short move (under the jump threshold)', () => {
    // ~100m apart — a plausible move within one ~5s poll interval.
    expect(shouldAnimateMarkerMove(40.7608, -111.8910, 40.7617, -111.8910)).toBe(true);
  });

  it('skips animation for an implausible long jump', () => {
    // SLC to Denver — not a real single-poll move; snap instead of glide.
    expect(shouldAnimateMarkerMove(40.7608, -111.8910, 39.7392, -104.9903)).toBe(false);
  });
});

describe('buildUnitMarkerEl — heading and accuracy', () => {
  it('rotates the badge when heading is present', () => {
    const el = buildUnitMarkerEl({ ...unit, gps_heading: 90 } as MapUnit);
    const badge = el.querySelector('[data-role="badge"]') as HTMLElement;
    expect(badge.style.transform).toContain('rotate(90deg)');
  });

  it('does not rotate when heading is null', () => {
    const el = buildUnitMarkerEl({ ...unit, gps_heading: null } as MapUnit);
    const badge = el.querySelector('[data-role="badge"]') as HTMLElement;
    expect(badge.style.transform).toBe('');
  });

  it('renders an accuracy ring when accuracy is present', () => {
    const el = buildUnitMarkerEl({ ...unit, gps_accuracy: 25 } as MapUnit);
    expect(el.querySelector('[data-role="accuracy-ring"]')).not.toBeNull();
  });

  it('omits the accuracy ring when accuracy is absent', () => {
    const el = buildUnitMarkerEl({ ...unit, gps_accuracy: null } as MapUnit);
    expect(el.querySelector('[data-role="accuracy-ring"]')).toBeNull();
  });

  it('computeAccuracyRingGeometry produces a single signed marginTop for a good-accuracy ring (pixelRadius <= 15)', () => {
    // gps_accuracy 20m -> pixelRadius 10 -> pre-fix this produced the invalid
    // double-minus `margin-top:-${10 - 15}px` == `margin-top:--5px`.
    const { pixelRadius, marginTop } = computeAccuracyRingGeometry(20);
    expect(pixelRadius).toBe(10);
    expect(marginTop).toBe(5);
  });

  it('computeAccuracyRingGeometry still produces a negative marginTop for a poor-accuracy ring (pixelRadius > 15)', () => {
    const { pixelRadius, marginTop } = computeAccuracyRingGeometry(100); // pixelRadius 50
    expect(pixelRadius).toBe(50);
    expect(marginTop).toBe(-35);
  });
});

describe('buildUnitMarkerEl — marker root vs inner wrapper (pan/zoom smear fix)', () => {
  it('root element has no CSS transition — mapboxgl.Marker snaps it instantly on every pan/zoom frame', () => {
    const el = buildUnitMarkerEl(unit);
    expect(el.style.transition).toBe('');
    expect(el.style.cssText).not.toContain('transition');
  });

  it('the glide transition lives on the inner [data-role="marker-inner"] wrapper instead', () => {
    const el = buildUnitMarkerEl(unit);
    const inner = el.querySelector('[data-role="marker-inner"]') as HTMLElement;
    expect(inner).not.toBeNull();
    expect(inner.style.transition).toContain('transform');
  });

  it('applyUnitMarkerState mutates the same inner wrapper node identity', () => {
    const el = buildUnitMarkerEl(unit);
    const innerBefore = el.querySelector('[data-role="marker-inner"]');
    applyUnitMarkerState(el, { ...unit, status: 'dispatched' } as MapUnit);
    expect(el.querySelector('[data-role="marker-inner"]')).toBe(innerBefore);
  });
});
