import { describe, it, expect } from 'vitest';
// Aliased on import: MapboxMiniMap's builder is named `buildCallMarkerEl`,
// the SAME name as the unrelated builder in
// client/src/pages/map/utils/mapMarkers.ts (see that file's own
// mapMarkers.test.ts). Explicit aliases here avoid any collision if this
// file is ever extended to import from both trees.
import { buildCallMarker as buildDispatchCallMarker } from '../DispatchMiniMap';
import { buildCallMarkerEl as buildMapboxCallMarkerEl } from '../MapboxMiniMap';
import { CALL_MARKER_INK } from '../../utils/statusColors';

// ── Regression guard ─────────────────────────────────────────────────────
// PRIORITY_HEX fills are now LIGHT (#ffbeb2 / #fc9c6e / #c29673 / #968778).
// A previous commit left `color:#fff` on these two mini-map badges, giving
// 1.58:1 contrast on P1 — a live-dispatch readability regression. Fixed by
// routing both builders' text + border through CALL_MARKER_INK (#0d1520).
// This test asserts the two builders actually USE that constant — the
// mapMarkers.test.ts assertion only checks the constant clears 4.5:1 against
// the fills, it never checks either builder reads it.
//
// jsdom (28.1.0 / cssstyle 6.2.0) quirk: assigning a `cssText` string that
// mixes the `background` shorthand with `border-radius` (both builders' tag
// element does this) silently VOIDS THE ENTIRE inline style, so
// `el.style.color` / `el.style.borderColor` always read back empty here —
// a naive assertion against them would pass vacuously regardless of what the
// source actually says. Spy on the cssText SETTER instead and assert against
// the captured string, same technique mapMarkers.test.ts uses for the same
// reason.
function captureCssText(build: () => void): string {
  const proto = (globalThis as unknown as { CSSStyleDeclaration: { prototype: CSSStyleDeclaration } }).CSSStyleDeclaration.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'cssText')!;
  const captured: string[] = [];
  Object.defineProperty(proto, 'cssText', {
    configurable: true,
    get: descriptor.get,
    set(v: string) { captured.push(v); descriptor.set!.call(this, v); },
  });
  try {
    build();
  } finally {
    Object.defineProperty(proto, 'cssText', descriptor);
  }
  return captured.join('\n');
}

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

const BUILDERS: Array<[string, (label: string, priority?: string) => HTMLElement]> = [
  ['DispatchMiniMap.buildCallMarker', buildDispatchCallMarker],
  ['MapboxMiniMap.buildCallMarkerEl', buildMapboxCallMarkerEl],
];

describe('mini-map call badge ink', () => {
  for (const [name, build] of BUILDERS) {
    for (const priority of PRIORITIES) {
      it(`${name} colors the ${priority} badge text + border with CALL_MARKER_INK, never white`, () => {
        const css = captureCssText(() => { build('TEST', priority); });

        expect(css, `${name} ${priority} cssText should assign text color to CALL_MARKER_INK`)
          .toContain(`color:${CALL_MARKER_INK};`);
        expect(css, `${name} ${priority} cssText should assign border color to CALL_MARKER_INK`)
          .toContain(`border:1.5px solid ${CALL_MARKER_INK};`);

        // The regression this guards against: reverting either builder back
        // to a bare white ink. Assert directly against the failure mode
        // rather than only the positive case.
        expect(css.toLowerCase(), `${name} ${priority} must not use white ink`).not.toMatch(/color:\s*#fff\b/);
        expect(css.toLowerCase(), `${name} ${priority} must not use a white border`).not.toMatch(/border:[^;]*#fff\b/);
      });
    }
  }
});
