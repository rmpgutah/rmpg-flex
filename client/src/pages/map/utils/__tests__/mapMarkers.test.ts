import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildUnitMarkerEl, applyUnitMarkerState, buildUnitPopupHtml, buildCallMarkerEl, buildCallPopupHtml, shouldAnimateMarkerMove, computeAccuracyRingGeometry, CALL_MARKER_INK, formatCallAge, formatEtaSeconds, formatDistanceMiles } from '../mapMarkers';
import { TACTICAL_SURFACE_RAISED, TACTICAL_BRAND_GOLD, TACTICAL_TEXT_PRIMARY } from '../tacticalPalette';
import type { MapUnit, ActiveCall } from '../mapConstants';
import { UNIT_STATUS_COLORS } from '../mapConstants';
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

  it('renders the unit badge as an arrow svg, not a filled circle', () => {
    const el = buildUnitMarkerEl(unit);
    const badge = el.querySelector('[data-role="badge"]');
    expect(badge?.querySelector('svg')).toBeTruthy();
    expect(badge?.querySelector('path')).toBeTruthy();
    // No circular badge fill/border-radius left on the badge element itself
    expect(badge?.getAttribute('style') || '').not.toContain('border-radius:50%');
  });

  it('rotates the arrow to gps_heading when present, and defaults to 0deg otherwise', () => {
    const withHeading = buildUnitMarkerEl({ ...unit, gps_heading: 90 } as MapUnit);
    const svgWithHeading = withHeading.querySelector('[data-role="badge"] svg') as SVGElement;
    expect(svgWithHeading.style.transform).toBe('rotate(90deg)');

    const withoutHeading = buildUnitMarkerEl({ ...unit, gps_heading: null } as MapUnit);
    const svgWithoutHeading = withoutHeading.querySelector('[data-role="badge"] svg') as SVGElement;
    expect(svgWithoutHeading.style.transform).toBe('rotate(0deg)');
  });

  it('applyUnitMarkerState updates the arrow rotation and fill color in place', () => {
    const el = buildUnitMarkerEl(unit);
    applyUnitMarkerState(el, { ...unit, status: 'busy', gps_heading: 200 } as MapUnit);
    const svg = el.querySelector('[data-role="badge"] svg') as SVGElement;
    expect(svg.style.transform).toBe('rotate(200deg)');
    const path = el.querySelector('[data-role="badge"] path') as SVGPathElement;
    expect(path.getAttribute('fill')).toBe(UNIT_STATUS_COLORS.busy);
  });

  it('builds a call marker element with the priority label', () => {
    const el = buildCallMarkerEl(call);
    const square = el.querySelector('[data-role="priority-square"]') as HTMLElement;
    expect(square.textContent).toBe('P1');
  });

  it('renders the call marker as a rounded square, not a rotated diamond', () => {
    const el = buildCallMarkerEl(call);
    const square = el.querySelector('[data-role="priority-square"]') as HTMLElement;
    expect(square.style.transform).toBe('');
    expect(square.style.borderRadius).toBe('2px');
  });

  it('renders a call-number label below the priority square', () => {
    const el = buildCallMarkerEl(call);
    const numberLabel = el.querySelector('[data-role="call-number-label"]') as HTMLElement;
    expect(numberLabel.textContent).toBe('CFS-1');
    // jsdom's cssstyle normalizes the `color` longhand to `rgb(r, g, b)` on
    // readback (unlike the `background` shorthand elsewhere in this file,
    // which round-trips as the literal hex string) — compare against the
    // equivalent rgb() form rather than the raw hex.
    expect(numberLabel.style.color).toBe(hexToRgb(priorityHex(call.priority)));
  });

  it('builds call popup HTML containing the call number', () => {
    expect(buildCallPopupHtml(call, false, Date.now())).toContain('CFS-1');
  });

  // ── "PP1" regression ────────────────────────────────────────────────────
  // Seen on the live map 2026-07-31: the diamond read "PP1", not "P1".
  // The label was hand-built as `P${call.priority}` while
  // calls_for_service.priority is DB-constrained to 'P1'..'P4' and passed
  // through verbatim by the dispatch queue route — so the prefix doubled.
  // priorityHex already normalized (which is why the COLOR was right and only
  // the TEXT was wrong); priorityLabel now shares that normalization.
  describe('priority label never double-prefixes', () => {
    // Both shapes occur in this tree: 'P1' live, bare '1' in fixtures.
    for (const [input, expected] of [['P1', 'P1'], ['1', 'P1'], ['P4', 'P4'], ['3', 'P3'], [1, 'P1']] as const) {
      it(`renders ${JSON.stringify(input)} as ${expected} on the marker`, () => {
        const el = buildCallMarkerEl({ ...call, priority: input } as unknown as ActiveCall);
        const square = el.querySelector('[data-role="priority-square"]') as HTMLElement;
        expect(square.textContent).toBe(expected);
        expect(square.textContent).not.toMatch(/^PP/);
      });
    }

    it('renders the same label in the popup', () => {
      const html = buildCallPopupHtml({ ...call, priority: 'P1' } as unknown as ActiveCall, false, Date.now());
      expect(html).toContain('>P1<');
      expect(html).not.toContain('PP1');
    });

    it('keeps the fill color and the label agreeing on the input shape', () => {
      // The original defect was exactly this disagreement.
      const bare = buildCallMarkerEl({ ...call, priority: '1' } as unknown as ActiveCall);
      const prefixed = buildCallMarkerEl({ ...call, priority: 'P1' } as unknown as ActiveCall);
      const square = (el: HTMLElement) => el.querySelector('[data-role="priority-square"]') as HTMLElement;
      expect(square(bare).textContent).toBe(square(prefixed).textContent);
      const fill = (el: HTMLElement) => square(el).style.background;
      expect(fill(bare)).toBe(fill(prefixed));
    });
  });

  describe('formatCallAge', () => {
    it('formats an elapsed duration as HH:MM:SS', () => {
      const created = '2026-08-09T12:00:00Z';
      const now = new Date('2026-08-09T12:14:32Z').getTime();
      expect(formatCallAge(created, now)).toBe('00:14:32');
    });

    it('formats durations over an hour with a non-zero hours segment', () => {
      const created = '2026-08-09T10:00:00Z';
      const now = new Date('2026-08-09T12:05:09Z').getTime();
      expect(formatCallAge(created, now)).toBe('02:05:09');
    });

    it('returns null when created_at is missing', () => {
      expect(formatCallAge(null, Date.now())).toBeNull();
      expect(formatCallAge(undefined, Date.now())).toBeNull();
    });

    it('returns null when created_at does not parse', () => {
      expect(formatCallAge('not-a-date', Date.now())).toBeNull();
    });
  });

  describe('buildCallPopupHtml header + field table', () => {
    const now = new Date('2026-08-09T12:14:32Z').getTime();
    const callWithAge: ActiveCall = { ...call, created_at: '2026-08-09T12:00:00Z' };

    it('shows the call-age timer under the call number when created_at is present', () => {
      const html = buildCallPopupHtml(callWithAge, false, now);
      expect(html).toContain('00:14:32');
      expect(html).toContain('open');
    });

    it('omits the timer line when created_at is missing', () => {
      const html = buildCallPopupHtml({ ...call, created_at: null }, false, now);
      expect(html).not.toContain('open');
    });

    it('shows STATUS, BEAT, ADDRESS, and UNIT rows in a labeled field table', () => {
      const html = buildCallPopupHtml({ ...callWithAge, beat_name: 'A-2' }, false, now);
      expect(html).toContain('STATUS');
      expect(html).toContain('BEAT');
      expect(html).toContain('ADDRESS');
      expect(html).toContain('UNIT');
      expect(html).toContain('A-2');
    });

    it('shows an em-dash placeholder for UNIT when no unit is assigned', () => {
      const html = buildCallPopupHtml(callWithAge, false, now);
      expect(html).toContain('unassigned');
    });
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

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

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
    const html = buildCallPopupHtml(call, false, Date.now());
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
  it('rotates the badge arrow svg when heading is present', () => {
    // Rotation moved from the badge div onto the inner arrow <svg> when the
    // circle badge was replaced with a directional arrow (see the dedicated
    // arrow-rotation tests above) — this test now guards the same invariant
    // one level down, on the svg rather than the badge wrapper itself.
    const el = buildUnitMarkerEl({ ...unit, gps_heading: 90 } as MapUnit);
    const svg = el.querySelector('[data-role="badge"] svg') as SVGElement;
    expect(svg.style.transform).toContain('rotate(90deg)');
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

  it('buildCallMarkerEl root carries no transform — mapboxgl overwrites it wholesale', () => {
    // The diamond's rotate(45deg) used to sit on the root, where Mapbox's
    // per-frame `element.style.transform = ...` deleted it: the diamond
    // flattened to a square while the counter-rotated "P1" span stayed tilted.
    const el = buildCallMarkerEl(call);
    expect(el.style.transform).toBe('');
    expect(el.style.cssText).not.toContain('transform');
  });

  it('buildCallMarkerEl renders a rounded square with no rotation on the priority square', () => {
    const el = buildCallMarkerEl(call);
    const square = el.querySelector('[data-role="priority-square"]') as HTMLElement;
    expect(square).not.toBeNull();
    expect(square.style.transform).toBe('');
    expect(square.textContent).toBe('P1');
  });

  it('applyUnitMarkerState mutates the same inner wrapper node identity', () => {
    const el = buildUnitMarkerEl(unit);
    const innerBefore = el.querySelector('[data-role="marker-inner"]');
    applyUnitMarkerState(el, { ...unit, status: 'dispatched' } as MapUnit);
    expect(el.querySelector('[data-role="marker-inner"]')).toBe(innerBefore);
  });
});

describe('unit marker tactical palette', () => {
  // Unit markers deliberately use a FIXED near-black, NOT a theme variable:
  // buildUnitMarkerEl also renders inside DashboardMiniMap, which has no
  // `.tactical-dark` ancestor, so `var(--surface-sunken)` would resolve to the
  // ambient theme there (light tan under html.theme-light). The invariant worth
  // guarding is therefore "defined once as a named constant", not "no hex".
  const src = () => readFileSync(resolve(__dirname, '../mapMarkers.ts'), 'utf8');

  it('declares the near-black tactical value exactly once, as a named constant', () => {
    const body = src();
    const occurrences = body.match(/#0d1520/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(body).toMatch(/const TACTICAL_BADGE_SURFACE = '#0d1520';/);
  });

  it('routes the arrow outline color through that constant', () => {
    const body = src();
    // The circle badge (background/border) was replaced by a directional
    // arrow <svg> — TACTICAL_BADGE_SURFACE now outlines the arrow path
    // instead of filling the old badge div, but it's still the single source
    // of truth, set on both the build path (buildUnitArrowSvg) and the
    // in-place update path (applyUnitMarkerState).
    expect(body.match(/setAttribute\('stroke', TACTICAL_BADGE_SURFACE\)/g) ?? []).toHaveLength(2);
    // And it must not have drifted back onto an ambient theme variable.
    expect(body).not.toMatch(/setAttribute\('stroke', 'var\(/);
  });
});

describe('formatEtaSeconds / formatDistanceMiles', () => {
  it('formats seconds as mm:ss, zero-padded', () => {
    expect(formatEtaSeconds(192)).toBe('03:12');
    expect(formatEtaSeconds(5)).toBe('00:05');
    expect(formatEtaSeconds(0)).toBe('00:00');
  });

  it('formats miles to one decimal place', () => {
    expect(formatDistanceMiles(1.44)).toBe('1.4 mi');
    expect(formatDistanceMiles(0)).toBe('0.0 mi');
    expect(formatDistanceMiles(12.98)).toBe('13.0 mi');
  });
});

describe('en-route tag on the unit marker', () => {
  const enrouteUnit: MapUnit = { ...unit, status: 'enroute' } as MapUnit;

  it('does not render an en-route tag when enRoute data is omitted', () => {
    const el = buildUnitMarkerEl(enrouteUnit);
    expect(el.querySelector('[data-role="enroute-tag"]')).toBeNull();
  });

  it('renders unit call sign, ENROUTE, ETA, and DIS when enRoute data is provided', () => {
    const el = buildUnitMarkerEl(enrouteUnit, { etaSeconds: 192, distanceMiles: 1.44 });
    const tag = el.querySelector('[data-role="enroute-tag"]') as HTMLElement;
    expect(tag).toBeTruthy();
    expect(tag.textContent).toContain('A12');
    expect(tag.textContent).toContain('ENROUTE');
    expect(tag.textContent).toContain('ETA 03:12');
    expect(tag.textContent).toContain('DIS 1.4 mi');
  });

  it('applyUnitMarkerState adds/removes the tag as enRoute data comes and goes', () => {
    const el = buildUnitMarkerEl(enrouteUnit);
    expect(el.querySelector('[data-role="enroute-tag"]')).toBeNull();

    applyUnitMarkerState(el, enrouteUnit, { etaSeconds: 60, distanceMiles: 0.5 });
    expect(el.querySelector('[data-role="enroute-tag"]')).toBeTruthy();

    applyUnitMarkerState(el, enrouteUnit, null);
    expect(el.querySelector('[data-role="enroute-tag"]')).toBeNull();
  });
});
