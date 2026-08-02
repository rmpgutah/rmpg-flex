# Features Overlay Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the map's Identify popup — which returns twelve rows of basemap noise for a school — with an overlays-only floating inspector panel that reuses one shared feature-description layer.

**Architecture:** Extract a pure `describeOsmFeature()` from the existing HTML popup builder so the popup and a new React panel render from one source of truth. Rewrite `useMapFeatureInspect` to filter `queryRenderedFeatures` through the existing `isOverlayLayer` predicate, dedupe, and rank — dropping the Tilequery network call entirely. Add a floating list+detail panel wired into `MapboxMapPage`.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + @testing-library/react, Mapbox GL JS, Tailwind (theme-variable-backed tokens).

**Spec:** [`docs/superpowers/specs/2026-08-02-features-overlay-inspector-design.md`](../specs/2026-08-02-features-overlay-inspector-design.md)

## Global Constraints

- **Never hardcode hex** in React components. Use the theme-variable-backed Tailwind tokens (`bg-surface-raised`, `text-rmpg-100`, `border-border-default`, etc.). `osmPopup.ts` keeps its existing literal hex — it is out of scope and must not be re-themed in this work.
- **Radius is 2px everywhere.** Never `rounded-lg`. The global Tailwind override enforces this, but don't write classes that fight it.
- **Gold is restricted to two roles only:** field labels (`--field-label-color`) and section/panel headers (`--panel-header-color`). Icons, borders, dividers, and secondary text stay silver. Never write a raw `text-accent-gold-*` class in a component.
- **Icon-only buttons must use `<IconButton aria-label="...">`** from `client/src/components/IconButton.tsx`.
- **Org standard is US units.** No bare metric value ever reaches the screen.
- **`describeOsmFeature` returns UNESCAPED values.** Escaping belongs to the renderer: `osmPopup.ts` escapes on the way into `innerHTML`; JSX escapes automatically. This invariant must appear in the module docblock.
- **Baseline is clean** (client typecheck 0 errors, client vitest all green). Any failure you see is caused by your change. A red gate is a hard stop.
- **Never run root and client vitest concurrently** — it fakes ~9 failures. Run serially.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Unit traps — read before writing any distance code

Two conversions in this plan are easy to get silently wrong. Both produce
plausible-looking numbers.

1. **`haversineDistance` returns MILES.** `metresToUsDistance` takes METRES.
   Feeding miles into it reports a 90 ft offset as "0 ft". Convert explicitly:
   `metresToUsDistance(miles * 1609.344)`.
2. **A bare OSM `maxheight` is METRES and a bare `maxspeed` is KM/H.** Never add
   a code path that renders either raw. The existing formatters already handle
   this; don't bypass them.

---

## File Structure

| File | Responsibility |
|---|---|
| `client/src/utils/osmFeatureDescription.ts` | **New.** Pure OSM tags → structured `FeatureDescription`. Owns the `FIELDS` table and every unit formatter. No HTML, no React, no Mapbox. |
| `client/src/utils/osmPopup.ts` | **Modified.** Thin HTML renderer over `describeOsmFeature`. Re-exports formatters for back-compat. |
| `client/src/hooks/useMapFeatureInspect.ts` | **Rewritten.** Overlay-only hit testing, dedupe, ranking, nearest-feature fallback. Synchronous, no network. |
| `client/src/pages/map/components/FeatureInspectorPanel.tsx` | **New.** Floating list + selected-detail panel. |
| `client/src/pages/map/MapboxMapPage.tsx` | **Modified.** Renders the panel; owns the click marker and highlight source. |
| `client/src/utils/__tests__/osmFeatureDescription.test.ts` | **New.** Value-level tests for the description layer. |
| `client/src/hooks/__tests__/useMapFeatureInspect.test.ts` | **New.** Screenshot regression test with a stubbed map. |

---

### Task 1: Extract the pure description layer

Splits *what to say* from *how to say it*. The gate is that
`osmPopup.test.ts` stays green **unmodified** — proof the refactor changed no
rendering.

**Files:**
- Create: `client/src/utils/osmFeatureDescription.ts`
- Create: `client/src/utils/__tests__/osmFeatureDescription.test.ts`
- Modify: `client/src/utils/osmPopup.ts` (whole file restructured)

**Interfaces:**
- Consumes: `OSM_EXTRACT_DATE` from `../config/osmLayers.generated`, `parseTimestamp` from `./dateUtils`
- Produces:
  - `describeOsmFeature(props: Record<string, unknown>, opts?: DescribeOptions): FeatureDescription`
  - `interface DescribeOptions { categoryLabel?: string; groupLabel?: string; coverage?: string }`
  - `interface DescriptionRow { key: string; label: string; value: string }`
  - `interface FeatureDescription { title, categoryLabel?, groupLabel?, rows, extras, coverage?, rmpg, provenance, osmLink? }`
  - Formatters re-exported unchanged from `osmPopup.ts`: `formatSpeed`, `formatClearance`, `formatWeight`, `formatElevation`, `formatBearing`, `formatVoltage`, `formatOsmTimestamp`, `escapeHtml`

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/osmFeatureDescription.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { describeOsmFeature } from '../osmFeatureDescription';

const rowFor = (d: ReturnType<typeof describeOsmFeature>, label: string) =>
  d.rows.find((r) => r.label === label)?.value;

describe('describeOsmFeature', () => {
  it('titles from name, falling back to the category label', () => {
    expect(describeOsmFeature({ name: 'Woodstock Elementary' }).title)
      .toBe('Woodstock Elementary');
    expect(describeOsmFeature({}, { categoryLabel: 'Fire hydrants' }).title)
      .toBe('Fire hydrants');
    expect(describeOsmFeature({}).title).toBe('Feature');
  });

  it('converts a bare metric clearance, which OSM stores in metres', () => {
    // "3.8" alone next to a US address is a clearance error waiting to happen.
    expect(rowFor(describeOsmFeature({ maxheight: '3.8' }), 'Clearance'))
      .toBe('12\' 6"');
  });

  it('converts a bare speed limit, which OSM stores in km/h', () => {
    expect(rowFor(describeOsmFeature({ maxspeed: '72' }), 'Speed limit'))
      .toBe('45 mph (72 km/h)');
    expect(rowFor(describeOsmFeature({ maxspeed: '45 mph' }), 'Speed limit'))
      .toBe('45 mph');
  });

  it('omits absent fields rather than reporting them as unknown', () => {
    // "Unknown" would imply we looked and found nothing.
    const d = describeOsmFeature({ name: 'X' });
    expect(d.rows.map((r) => r.label)).not.toContain('Clearance');
    expect(d.rows.some((r) => r.value === 'Unknown')).toBe(false);
  });

  it('collapses phone and contact:phone to a single row', () => {
    const d = describeOsmFeature({ phone: '801-555-0100', 'contact:phone': '801-555-0199' });
    expect(d.rows.filter((r) => r.label === 'Phone')).toHaveLength(1);
    expect(rowFor(d, 'Phone')).toBe('801-555-0100');
  });

  it('routes unknown tags to extras, capped at 8', () => {
    const props: Record<string, string> = { name: 'X' };
    for (let i = 0; i < 12; i++) props[`weird_tag_${i}`] = `v${i}`;
    const d = describeOsmFeature(props);
    expect(d.extras).toHaveLength(8);
    expect(d.extras[0].key).toMatch(/^weird_tag_/);
  });

  it('keeps RMPG edit-layer markers out of rows and extras', () => {
    // A correction must never be mistaken for OpenStreetMap's own data.
    const d = describeOsmFeature({
      name: 'X', __rmpg_note: 'Gate code 4412', __rmpg_verified: true,
      __rmpg_verified_at: '2026-07-30T12:00:00Z', __rmpg_overridden: 'maxheight,name',
    });
    expect(d.rmpg.verified).toBe(true);
    expect(d.rmpg.note).toBe('Gate code 4412');
    expect(d.rmpg.verifiedAt).toBe('2026-07-30');
    expect(d.rmpg.overriddenFields).toEqual(['maxheight', 'name']);
    const allKeys = [...d.rows, ...d.extras].map((r) => r.key);
    expect(allKeys.some((k) => k.startsWith('__rmpg'))).toBe(false);
  });

  it('builds a canonical OSM link from the element id', () => {
    expect(describeOsmFeature({ osm_id: 'w12345' }).osmLink?.url)
      .toBe('https://www.openstreetmap.org/way/12345');
    expect(describeOsmFeature({ osm_id: 'n99' }).osmLink?.url)
      .toBe('https://www.openstreetmap.org/node/99');
    expect(describeOsmFeature({ osm_id: 'r7' }).osmLink?.url)
      .toBe('https://www.openstreetmap.org/relation/7');
    expect(describeOsmFeature({}).osmLink).toBeUndefined();
  });

  it('returns values UNESCAPED — escaping is the renderer\'s job', () => {
    // The panel gets escaping free from JSX; osmPopup escapes into innerHTML.
    // Escaping here would double-escape in the popup.
    const d = describeOsmFeature({ name: 'A & B <script>' });
    expect(d.title).toBe('A & B <script>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/osmFeatureDescription.test.ts`
Expected: FAIL — `Failed to resolve import "../osmFeatureDescription"`

- [ ] **Step 3: Create the description module**

Create `client/src/utils/osmFeatureDescription.ts`. Move the formatters,
`FIELDS`, `HANDLED_ELSEWHERE`, and `humanValue` **verbatim** out of
`osmPopup.ts` — do not retune any conversion, or `osmPopup.test.ts` will break
and you will have lost the proof that rendering is unchanged.

```ts
// ============================================================
// RMPG Flex — Structured description of an OSM overlay feature
// ============================================================
// Splits WHAT to say about a feature from HOW to render it. The map has two
// consumers with incompatible output needs — an innerHTML popup and a React
// panel — and duplicating the field table into both is exactly how they
// diverge. Both render from this one description.
//
// Org standard is US units. OSM stores several fields metric by default: a
// bare `maxheight` is METRES, a bare `maxspeed` is KM/H, `ele` is metres. A
// bare metric number next to a US address is a readability trap at best and a
// clearance error at worst, so nothing is emitted without an explicit unit.
//
// ⚠️ VALUES ARE RETURNED UNESCAPED. Escaping belongs to the renderer: JSX
// escapes automatically, and osmPopup.ts escapes on the way into innerHTML.
// Escaping here would double-escape every popup value. Never "fix" this by
// escaping at the source — fix the renderer that forgot.
// ============================================================

import { OSM_EXTRACT_DATE } from '../config/osmLayers.generated';
import { parseTimestamp } from './dateUtils';

// ── Unit conversion ─────────────────────────────────────────
// (moved verbatim from osmPopup.ts — formatSpeed, formatClearance,
//  formatWeight, formatElevation, formatBearing, formatVoltage,
//  formatOsmTimestamp, humanValue. Copy them exactly as they are.)

// ── Field table ─────────────────────────────────────────────
// (moved verbatim from osmPopup.ts — Formatter, FieldDef, FIELDS,
//  HANDLED_ELSEWHERE. Copy them exactly as they are.)

// ── Description ─────────────────────────────────────────────

export interface DescriptionRow {
  /** Original OSM tag, for React keys and debugging. */
  key: string;
  label: string;
  /** Already converted, already US units, NOT escaped. */
  value: string;
}

export interface DescribeOptions {
  /** Operator-facing category name, e.g. "Fire hydrants". */
  categoryLabel?: string;
  /** Catalog group, e.g. "Fire & life safety". */
  groupLabel?: string;
  /** Coverage caveat for this layer's coverage class. */
  coverage?: string;
}

export interface FeatureDescription {
  title: string;
  categoryLabel?: string;
  groupLabel?: string;
  rows: DescriptionRow[];
  extras: DescriptionRow[];
  coverage?: string;
  rmpg: {
    verified: boolean;
    verifiedAt?: string;
    note?: string;
    overriddenFields: string[];
  };
  provenance: { extractDate: string; editedDate?: string };
  osmLink?: { id: string; url: string };
}

const MAX_EXTRAS = 8;

export function describeOsmFeature(
  props: Record<string, unknown>,
  opts: DescribeOptions = {},
): FeatureDescription {
  const name = String(props.name ?? '').trim();

  const rows: DescriptionRow[] = [];
  const seenLabels = new Set<string>();
  for (const [key, def] of FIELDS) {
    const raw = props[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    // `phone`/`contact:phone` and `website`/`contact:website` both map to one
    // label; show the first that exists rather than the same row twice.
    if (seenLabels.has(def.label)) continue;
    const value = def.format ? def.format(raw) : String(raw);
    if (value === null || value === '') continue;
    seenLabels.add(def.label);
    rows.push({ key, label: def.label, value });
  }

  // Anything captured but not in the field table — shown so full OSM capture is
  // actually visible, rather than silently dropped by an incomplete table.
  const extras: DescriptionRow[] = Object.keys(props)
    .filter((k) => !HANDLED_ELSEWHERE.has(k) && !FIELDS.some(([fk]) => fk === k))
    .filter((k) => String(props[k] ?? '').trim() !== '')
    .slice(0, MAX_EXTRAS)
    .map((k) => ({ key: k, label: k, value: String(props[k]) }));

  const verifiedAt = String(props.__rmpg_verified_at ?? '').trim();
  const note = String(props.__rmpg_note ?? '').trim();
  const overridden = String(props.__rmpg_overridden ?? '').trim();

  const osmId = String(props.osm_id ?? '').trim();
  let osmLink: FeatureDescription['osmLink'];
  if (osmId) {
    const type = osmId[0] === 'n' ? 'node' : osmId[0] === 'w' ? 'way' : 'relation';
    osmLink = { id: osmId, url: `https://www.openstreetmap.org/${type}/${osmId.slice(1)}` };
  }

  const editedDate = formatOsmTimestamp(props.osm_timestamp) ?? undefined;

  return {
    title: name || opts.categoryLabel || 'Feature',
    categoryLabel: opts.categoryLabel,
    groupLabel: opts.groupLabel,
    rows,
    extras,
    coverage: opts.coverage,
    rmpg: {
      verified: props.__rmpg_verified === true || props.__rmpg_verified === 'true',
      verifiedAt: verifiedAt ? verifiedAt.slice(0, 10) : undefined,
      note: note || undefined,
      overriddenFields: overridden ? overridden.split(',').map((s) => s.trim()).filter(Boolean) : [],
    },
    provenance: { extractDate: OSM_EXTRACT_DATE, editedDate },
    osmLink,
  };
}
```

Export the formatters from this module (`export function formatSpeed(...)`
etc., exactly as they were).

- [ ] **Step 4: Run the new test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/osmFeatureDescription.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Rewrite `osmPopup.ts` to render from the description**

Replace the body of `buildOsmPopupHtml` so it calls `describeOsmFeature` and
renders the result. Keep the `C` palette, the existing markup, and the emitted
byte order **identical** — this is a refactor, not a redesign. Delete the
now-moved formatters and `FIELDS` from this file and re-export instead:

```ts
import {
  describeOsmFeature, type DescribeOptions,
  formatSpeed, formatClearance, formatWeight, formatElevation,
  formatBearing, formatVoltage, formatOsmTimestamp,
} from './osmFeatureDescription';

// Re-exported for back-compat: osmPopup.test.ts and any existing consumer
// import these from here. The implementations now live in the description
// module so the React panel can use them without importing a popup builder.
export {
  formatSpeed, formatClearance, formatWeight, formatElevation,
  formatBearing, formatVoltage, formatOsmTimestamp,
};

export type OsmPopupOptions = DescribeOptions;

export function buildOsmPopupHtml(
  props: Record<string, unknown>,
  opts: OsmPopupOptions = {},
): string {
  const d = describeOsmFeature(props, opts);
  // ... same markup as before, reading from `d` instead of recomputing.
  // EVERY interpolation stays wrapped in escapeHtml(): these values are
  // deliberately unescaped at the source.
}
```

`escapeHtml` stays defined and exported from `osmPopup.ts`.

- [ ] **Step 6: Run the existing popup test UNMODIFIED**

Run: `cd client && npx vitest run src/utils/__tests__/osmPopup.test.ts`
Expected: PASS, all existing tests, **with zero edits to that file**.

If it fails, you changed rendering. Fix the renderer — do not edit the test.

- [ ] **Step 7: Typecheck and commit**

```bash
cd client && npx tsc --noEmit
```
Expected: 0 errors.

```bash
git add client/src/utils/osmFeatureDescription.ts \
        client/src/utils/osmPopup.ts \
        client/src/utils/__tests__/osmFeatureDescription.test.ts
git commit -m "refactor(map): extract describeOsmFeature from the OSM popup builder

The popup builder returned an HTML string, so a React consumer could not
reuse its field table, unit conversions, or ordering without duplicating
them. Splits the description from the rendering; osmPopup now renders from
describeOsmFeature and re-exports the formatters.

osmPopup.test.ts passes unmodified — rendering is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Rewrite the hook to return overlays only

This is the task that fixes the reported screenshot.

**Files:**
- Modify: `client/src/hooks/useMapFeatureInspect.ts` (whole file rewritten)
- Create: `client/src/hooks/__tests__/useMapFeatureInspect.test.ts`

**Interfaces:**
- Consumes: `isOverlayLayer`, `humanLayerLabel`, `layerGroupLabel`, `configIdFromLayerId` from `../utils/osmLayerLabels`; `OSM_VECTOR_CONFIGS` from `./useVectorTileLayers`; `OSM_GROUPS` from `../config/osmLayers.generated`
- Produces:
  - `interface InspectedFeature { key, layerId, categoryLabel, groupLabel, coverage, properties, geometry, awayLabel? }`
  - `interface InspectionResult { lngLat, features, widened, timestamp }`
  - `useMapFeatureInspect(map, mapLoaded)` returns `{ enabled, result, selectedIndex, select, toggle, clear }`

- [ ] **Step 1: Write the failing test**

Create `client/src/hooks/__tests__/useMapFeatureInspect.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapFeatureInspect } from '../useMapFeatureInspect';

/** The exact layer set a click on Woodstock Elementary returned in the
 *  reported screenshot: one real overlay hit buried under eleven rows of
 *  basemap geometry and internal RMPG render layers. */
const SCREENSHOT_FEATURES = [
  { layer: { id: 'vt-osm_sites_school-circle' }, properties: { name: 'Woodstock Elementary School', osm_id: 'w101' }, geometry: { type: 'Point', coordinates: [-111.85355, 40.64199] } },
  { layer: { id: 'rmpg-coverage-gaps-fill' }, properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
  { layer: { id: 'landuse' }, properties: { class: 'school' }, geometry: { type: 'Polygon', coordinates: [] } },
  { layer: { id: 'road' }, properties: { class: 'sidewalk' }, geometry: { type: 'LineString', coordinates: [] } },
  { layer: { id: 'road' }, properties: { class: 'crossing' }, geometry: { type: 'LineString', coordinates: [] } },
  { layer: { id: 'landuse' }, properties: { class: 'surface' }, geometry: { type: 'Polygon', coordinates: [] } },
  { layer: { id: 'road' }, properties: { class: 'service' }, geometry: { type: 'LineString', coordinates: [] } },
  { layer: { id: 'building' }, properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
  { layer: { id: 'water' }, properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
  { layer: { id: 'poi_label' }, properties: {}, geometry: { type: 'Point', coordinates: [] } },
  { layer: { id: 'admin' }, properties: {}, geometry: { type: 'LineString', coordinates: [] } },
  { layer: { id: 'landuse_overlay' }, properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
];

function makeMap(queryResults: any[] | ((box: any) => any[])) {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  return {
    getCanvas: () => ({ style: {} }),
    queryRenderedFeatures: vi.fn((box: any) =>
      typeof queryResults === 'function' ? queryResults(box) : queryResults),
    on: vi.fn((event: string, cb: (e: any) => void) => { (listeners[event] ??= []).push(cb); }),
    off: vi.fn((event: string, cb: (e: any) => void) => {
      listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
    }),
    _click: (e: any) => { (listeners['click'] || []).forEach((cb) => cb(e)); },
  } as any;
}

const CLICK = { point: { x: 400, y: 300 }, lngLat: { lng: -111.85355, lat: 40.64199 } };

describe('useMapFeatureInspect', () => {
  it('returns ONE result for the twelve-feature screenshot click', () => {
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    expect(result.current.result?.features).toHaveLength(1);
    expect(result.current.result?.features[0].properties.name)
      .toBe('Woodstock Elementary School');
  });

  it('filters out internal RMPG render layers and basemap geometry', () => {
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    const layerIds = result.current.result!.features.map((f) => f.layerId);
    expect(layerIds).not.toContain('rmpg-coverage-gaps-fill');
    expect(layerIds).not.toContain('landuse');
    expect(layerIds).not.toContain('road');
  });

  it('labels the hit with the operator-facing category, not the layer id', () => {
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    const hit = result.current.result!.features[0];
    expect(hit.categoryLabel).not.toContain('vt-');
    expect(hit.categoryLabel.length).toBeGreaterThan(0);
  });

  it('collapses a feature returned once per tile into a single row', () => {
    const dup = SCREENSHOT_FEATURES[0];
    const map = makeMap([dup, { ...dup }, { ...dup }]);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    expect(result.current.result?.features).toHaveLength(1);
  });

  it('makes no network call', () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does nothing while the tool is switched off', () => {
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { map._click(CLICK); });
    expect(result.current.result).toBeNull();
  });

  it('selects the first hit by default so a single result needs no click', () => {
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });
    expect(result.current.selectedIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapFeatureInspect.test.ts`
Expected: FAIL — the current hook is async, calls Tilequery, and returns 12+ unfiltered features with no `selectedIndex`.

- [ ] **Step 3: Rewrite the hook**

Replace `client/src/hooks/useMapFeatureInspect.ts` entirely:

```ts
/**
 * useMapFeatureInspect — "what is HERE?", not "what geometry is under my cursor?"
 *
 * Click the map with Identify active to inspect RMPG's own overlay features at
 * that point. Basemap geometry (roads, landuse, buildings) and internal render
 * layers (the coverage-gap grid) are suppressed entirely: a click on a school
 * used to return twelve rows, eleven of which an officer had to read past.
 *
 * Synchronous by design. The old implementation also queried the Tilequery API
 * against mapbox.mapbox-streets-v8 — the BASEMAP tileset, which contains none
 * of our overlays — so every one of those rows was discarded by the filter
 * below. It was a billed round-trip per click that answered nothing.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type mapboxgl from 'mapbox-gl';
import {
  isOverlayLayer, humanLayerLabel, layerGroupLabel, configIdFromLayerId,
} from '../utils/osmLayerLabels';
import { OSM_VECTOR_CONFIGS } from './useVectorTileLayers';
import { OSM_GROUPS } from '../config/osmLayers.generated';

/** Half-width of the hit box, in screen pixels. An exact-point query makes a
 *  5px miss on a hydrant read as "no hydrant". */
export const HIT_TOLERANCE_PX = 8;

export interface InspectedFeature {
  /** Dedupe/React key. */
  key: string;
  layerId: string;
  categoryLabel: string;
  groupLabel: string | null;
  coverage?: string;
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
  /** Set only on the widened nearest-feature path, e.g. "90 ft NE". */
  awayLabel?: string;
}

export interface InspectionResult {
  lngLat: [number, number];
  features: InspectedFeature[];
  /** True when nothing was found at the click point and the search widened. */
  widened: boolean;
  timestamp: number;
}

/** configId -> coverage caveat, so a hit can carry its layer's caveat. */
const COVERAGE_BY_CONFIG_ID: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const c of OSM_VECTOR_CONFIGS) if (c.coverage) out[c.id] = c.coverage;
  return out;
})();

/** configId -> catalog declaration order, so ranking matches the layer picker
 *  rather than whatever order Mapbox happened to return. */
const ORDER_BY_CONFIG_ID: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let i = 0;
  for (const g of OSM_GROUPS) for (const c of g.categories) out[`osm_${g.name}_${c.cat}`] = i++;
  return out;
})();

function boxAround(p: { x: number; y: number }, tol: number):
  [mapboxgl.PointLike, mapboxgl.PointLike] {
  return [[p.x - tol, p.y - tol], [p.x + tol, p.y + tol]];
}

/** Overlay hits only, deduped and ranked. */
export function collectOverlayFeatures(raw: any[]): InspectedFeature[] {
  const byKey = new Map<string, InspectedFeature>();
  for (const f of raw) {
    const layerId = f?.layer?.id;
    if (!layerId || !isOverlayLayer(layerId)) continue;
    const props = (f.properties || {}) as Record<string, unknown>;
    const cfgId = configIdFromLayerId(layerId) ?? layerId;
    // A polygon spanning several tiles comes back once per tile. osm_id is the
    // real identity; fall back to layer+name when the archive omits it.
    const osmId = String(props.osm_id ?? '').trim();
    const key = osmId || `${cfgId}:${String(props.name ?? '')}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      key,
      layerId,
      categoryLabel: humanLayerLabel(layerId) ?? layerId,
      groupLabel: layerGroupLabel(layerId),
      coverage: COVERAGE_BY_CONFIG_ID[cfgId],
      properties: props,
      geometry: f.geometry,
    });
  }
  return [...byKey.values()].sort((a, b) => {
    const ao = ORDER_BY_CONFIG_ID[configIdFromLayerId(a.layerId) ?? ''] ?? 999;
    const bo = ORDER_BY_CONFIG_ID[configIdFromLayerId(b.layerId) ?? ''] ?? 999;
    if (ao !== bo) return ao - bo;
    return String(a.properties.name ?? '').localeCompare(String(b.properties.name ?? ''));
  });
}

export function useMapFeatureInspect(map: mapboxgl.Map | null, mapLoaded: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;

    const handler = (e: mapboxgl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      const raw = map.queryRenderedFeatures(boxAround(e.point, HIT_TOLERANCE_PX)) as any[];
      const features = collectOverlayFeatures(raw);
      setResult({ lngLat: [lng, lat], features, widened: false, timestamp: Date.now() });
      setSelectedIndex(0);
    };

    map.getCanvas().style.cursor = 'help';
    map.on('click', handler);
    return () => {
      map.off('click', handler);
      map.getCanvas().style.cursor = '';
    };
  }, [map, mapLoaded, enabled]);

  const clear = useCallback(() => { setResult(null); setSelectedIndex(0); }, []);
  const select = useCallback((i: number) => setSelectedIndex(i), []);
  const toggle = useCallback(() => {
    setEnabled((v) => {
      if (v) { setResult(null); setSelectedIndex(0); }
      return !v;
    });
  }, []);

  return { enabled, result, selectedIndex, select, toggle, clear };
}
```

Note the `toggle` fix: the previous version read the stale `enabled` from
closure to decide whether to clear, so clearing happened one toggle late.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapFeatureInspect.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors. `MapboxMapPage.tsx:1214` uses only `enabled`/`toggle`, both still present.

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useMapFeatureInspect.ts \
        client/src/hooks/__tests__/useMapFeatureInspect.test.ts
git commit -m "fix(map): Identify returns overlay features only

A click on a school returned twelve rows: one school and eleven rows of
basemap geometry and internal render layer ids, including a raw
'rmpg-coverage-gaps-fill'. Filters hits through isOverlayLayer, dedupes by
osm_id, and ranks by catalog order.

Drops the Tilequery call: it queried mapbox-streets-v8, the basemap tileset,
which contains none of our overlays, so every row it returned was discarded.
It was a billed round-trip per click. Also fixes toggle() reading a stale
enabled from closure, which cleared results one toggle late.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Nearest-feature fallback

Without this, the overlays-only filter makes near-misses read as "nothing
here" — a worse failure than the noise it replaced.

**Files:**
- Modify: `client/src/hooks/useMapFeatureInspect.ts`
- Modify: `client/src/hooks/__tests__/useMapFeatureInspect.test.ts`

**Interfaces:**
- Consumes: `haversineDistance(lat1, lng1, lat2, lng2): number` **in MILES** from `../utils/unitRecommendation`; `metresToUsDistance(m)` and `formatBearing(deg)` from `../utils/osmLayerLabels` and `../utils/osmFeatureDescription`
- Produces: `WIDEN_STEPS_PX`, `representativePoint(geometry)`, `awayLabelFor(from, geometry)`; `InspectionResult.widened` becomes meaningful

- [ ] **Step 1: Write the failing test**

Append to `client/src/hooks/__tests__/useMapFeatureInspect.test.ts`:

```ts
import { representativePoint, awayLabelFor } from '../useMapFeatureInspect';

describe('nearest-feature fallback', () => {
  const HYDRANT = {
    layer: { id: 'vt-osm_safety_hydrant-circle' },
    properties: { name: 'Hydrant', osm_id: 'n55' },
    // ~90 ft north-east of the click point.
    geometry: { type: 'Point', coordinates: [-111.85333, 40.64218] },
  };

  it('widens the search when the exact point catches nothing', () => {
    // Empty at 8px, the hydrant at 40px.
    const map = makeMap((box: any) => {
      const halfWidth = (box[1][0] - box[0][0]) / 2;
      return halfWidth <= 8 ? [] : [HYDRANT];
    });
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    expect(result.current.result?.widened).toBe(true);
    expect(result.current.result?.features).toHaveLength(1);
    expect(result.current.result?.features[0].awayLabel).toMatch(/ft/);
  });

  it('reports an empty result rather than going silent', () => {
    // Silence is indistinguishable from the tool being broken or switched off.
    const map = makeMap([]);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    expect(result.current.result).not.toBeNull();
    expect(result.current.result?.features).toHaveLength(0);
    expect(result.current.result?.lngLat).toEqual([-111.85355, 40.64199]);
  });

  it('never attaches a distance on the exact-point path', () => {
    // Everything inside an 8px box is a few feet away; a distance there is
    // noise dressed as information.
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    expect(result.current.result?.widened).toBe(false);
    expect(result.current.result?.features[0].awayLabel).toBeUndefined();
  });

  it('derives a representative point from any geometry type', () => {
    expect(representativePoint({ type: 'Point', coordinates: [1, 2] } as any)).toEqual([1, 2]);
    expect(representativePoint({
      type: 'LineString', coordinates: [[0, 0], [2, 4]],
    } as any)).toEqual([1, 2]);
    expect(representativePoint({ type: 'Point', coordinates: [] } as any)).toBeNull();
  });

  it('reports distance in US units with a compass bearing', () => {
    // haversineDistance returns MILES; feeding it to metresToUsDistance
    // unconverted reports a 90 ft offset as "0 ft".
    const label = awayLabelFor([-111.85355, 40.64199],
      { type: 'Point', coordinates: [-111.85355, 40.64218] } as any);
    expect(label).toMatch(/^\d+ ft N/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapFeatureInspect.test.ts`
Expected: FAIL — `representativePoint` and `awayLabelFor` are not exported; `widened` is always false.

- [ ] **Step 3: Implement the fallback**

Add to `useMapFeatureInspect.ts`:

```ts
import { haversineDistance } from '../utils/unitRecommendation';
import { metresToUsDistance } from '../utils/osmLayerLabels';
import { formatBearing } from '../utils/osmFeatureDescription';

/** Hit box half-widths, in screen pixels. The first is the normal path; the
 *  rest widen only when nothing was found, so a near-miss on a hydrant is not
 *  reported as "no hydrant". */
export const WIDEN_STEPS_PX = [HIT_TOLERANCE_PX, 40, 120];

const METRES_PER_MILE = 1609.344;

/** A single lng/lat standing in for any geometry, for distance purposes. */
export function representativePoint(geometry: GeoJSON.Geometry): [number, number] | null {
  const coords: number[][] = [];
  const walk = (c: any) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') { coords.push(c as number[]); return; }
    for (const child of c) walk(child);
  };
  walk((geometry as any)?.coordinates);
  if (!coords.length) return null;
  const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return [lng, lat];
}

/** "90 ft NE" — distance and bearing from the click to a feature. */
export function awayLabelFor(
  from: [number, number],
  geometry: GeoJSON.Geometry,
): string | undefined {
  const to = representativePoint(geometry);
  if (!to) return undefined;
  // ⚠️ haversineDistance returns MILES; metresToUsDistance takes METRES.
  const metres = haversineDistance(from[1], from[0], to[1], to[0]) * METRES_PER_MILE;
  if (!Number.isFinite(metres)) return undefined;
  const dLng = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180);
  const dLat = to[1] - from[1];
  const deg = (Math.atan2(dLng, dLat) * 180) / Math.PI;
  const bearing = formatBearing(String(deg))?.replace(/\s*\(.*\)$/, '') ?? '';
  const dist = metresToUsDistance(metres);
  return dist ? `${dist}${bearing ? ` ${bearing}` : ''}` : undefined;
}
```

Replace the click handler body:

```ts
    const handler = (e: mapboxgl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      const from: [number, number] = [lng, lat];

      for (let step = 0; step < WIDEN_STEPS_PX.length; step++) {
        const raw = map.queryRenderedFeatures(boxAround(e.point, WIDEN_STEPS_PX[step])) as any[];
        const features = collectOverlayFeatures(raw);
        if (!features.length) continue;
        const widened = step > 0;
        setResult({
          lngLat: from,
          // Distance is load-bearing only when we widened to find these.
          features: widened
            ? features.map((f) => ({ ...f, awayLabel: awayLabelFor(from, f.geometry) }))
            : features,
          widened,
          timestamp: Date.now(),
        });
        setSelectedIndex(0);
        return;
      }

      // Nothing anywhere near. Report it explicitly — silence is
      // indistinguishable from the tool being broken or switched off.
      setResult({ lngLat: from, features: [], widened: false, timestamp: Date.now() });
      setSelectedIndex(0);
    };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapFeatureInspect.test.ts`
Expected: PASS, 12 tests

- [ ] **Step 5: Typecheck and commit**

```bash
cd client && npx tsc --noEmit
```
Expected: 0 errors.

```bash
git add client/src/hooks/useMapFeatureInspect.ts \
        client/src/hooks/__tests__/useMapFeatureInspect.test.ts
git commit -m "feat(map): nearest-feature fallback for Identify

With basemap noise filtered out, a click that misses an overlay by a few
pixels caught nothing. Widens the hit box to 40px then 120px only when the
exact point finds nothing, reporting the nearest feature with distance and
bearing. Zero hits report an explicit empty result rather than going silent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The inspector panel component

**Files:**
- Create: `client/src/pages/map/components/FeatureInspectorPanel.tsx`
- Create: `client/src/pages/map/components/__tests__/FeatureInspectorPanel.test.tsx`

**Interfaces:**
- Consumes: `InspectionResult`, `InspectedFeature` from `../../../hooks/useMapFeatureInspect`; `describeOsmFeature` from `../../../utils/osmFeatureDescription`; `OSM_ICON_BY_CAT` from `../../../utils/osmIcons`; `IconButton` from `../../../components/IconButton`
- Produces: default export `FeatureInspectorPanel(props: FeatureInspectorPanelProps)` where
  `interface FeatureInspectorPanelProps { result: InspectionResult; selectedIndex: number; onSelect(i: number): void; onClose(): void; onHoverFeature(f: InspectedFeature | null): void }`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/components/__tests__/FeatureInspectorPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FeatureInspectorPanel from '../FeatureInspectorPanel';
import type { InspectionResult } from '../../../../hooks/useMapFeatureInspect';

const base = { lngLat: [-111.85355, 40.64199] as [number, number], widened: false, timestamp: 0 };

const school = {
  key: 'w101', layerId: 'vt-osm_sites_school-circle',
  categoryLabel: 'Schools & childcare', groupLabel: 'Sensitive & high-risk sites',
  properties: { name: 'Woodstock Elementary School', 'addr:city': 'Salt Lake City', maxheight: '3.8' },
  geometry: { type: 'Point', coordinates: [-111.85355, 40.64199] } as any,
};
const hydrant = {
  key: 'n55', layerId: 'vt-osm_safety_hydrant-circle',
  categoryLabel: 'Fire hydrants', groupLabel: 'Fire & life safety',
  properties: { name: 'Hydrant 12' },
  geometry: { type: 'Point', coordinates: [-111.853, 40.642] } as any,
};

const noop = () => {};
const props = { selectedIndex: 0, onSelect: noop, onClose: noop, onHoverFeature: noop };

describe('FeatureInspectorPanel', () => {
  it('shows the selected feature detail without an extra click', () => {
    const result: InspectionResult = { ...base, features: [school] };
    render(<FeatureInspectorPanel {...props} result={result} />);
    expect(screen.getByText('Woodstock Elementary School')).toBeInTheDocument();
    expect(screen.getByText('Salt Lake City')).toBeInTheDocument();
  });

  it('renders OSM metric tags in US units', () => {
    const result: InspectionResult = { ...base, features: [school] };
    render(<FeatureInspectorPanel {...props} result={result} />);
    expect(screen.getByText('12\' 6"')).toBeInTheDocument();
    expect(screen.queryByText('3.8')).not.toBeInTheDocument();
  });

  it('lists every hit and reports the selection', () => {
    const onSelect = vi.fn();
    const result: InspectionResult = { ...base, features: [school, hydrant] };
    render(<FeatureInspectorPanel {...props} result={result} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Hydrant 12'));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('reports hover so the map can highlight the geometry', () => {
    const onHoverFeature = vi.fn();
    const result: InspectionResult = { ...base, features: [school, hydrant] };
    render(<FeatureInspectorPanel {...props} result={result} onHoverFeature={onHoverFeature} />);
    fireEvent.mouseEnter(screen.getByText('Hydrant 12'));
    expect(onHoverFeature).toHaveBeenCalledWith(hydrant);
    fireEvent.mouseLeave(screen.getByText('Hydrant 12'));
    expect(onHoverFeature).toHaveBeenLastCalledWith(null);
  });

  it('states plainly when nothing is there', () => {
    const result: InspectionResult = { ...base, features: [] };
    render(<FeatureInspectorPanel {...props} result={result} />);
    expect(screen.getByText(/no overlay features here/i)).toBeInTheDocument();
    expect(screen.getByText(/-111\.85355/)).toBeInTheDocument();
  });

  it('shows the distance only when the search had to widen', () => {
    const away = { ...hydrant, awayLabel: '90 ft NE' };
    render(<FeatureInspectorPanel {...props}
      result={{ ...base, widened: true, features: [away] }} />);
    expect(screen.getByText('90 ft NE')).toBeInTheDocument();
  });

  it('marks an RMPG-verified feature distinctly from OSM data', () => {
    const verified = { ...school, properties: { ...school.properties, __rmpg_verified: true } };
    render(<FeatureInspectorPanel {...props} result={{ ...base, features: [verified] }} />);
    expect(screen.getByText(/RMPG VERIFIED/i)).toBeInTheDocument();
  });

  it('never leaks a raw layer id to the operator', () => {
    render(<FeatureInspectorPanel {...props} result={{ ...base, features: [school] }} />);
    expect(document.body.textContent).not.toContain('vt-osm_');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/FeatureInspectorPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "../FeatureInspectorPanel"`

- [ ] **Step 3: Implement the panel**

Create `client/src/pages/map/components/FeatureInspectorPanel.tsx`. Theme tokens
only — no hex. Gold appears only via `--field-label-color` (the row labels) and
`--panel-header-color` (the panel header); everything else is silver.

```tsx
// ============================================================
// RMPG Flex — Feature Inspector panel
// ============================================================
// Identify results for RMPG's own overlays. Renders from the shared
// describeOsmFeature description, so this panel and the map's feature-click
// popup can never drift apart on field selection or unit conversion.
// ============================================================

import { X } from 'lucide-react';
import IconButton from '../../../components/IconButton';
import { describeOsmFeature } from '../../../utils/osmFeatureDescription';
import { OSM_ICON_BY_CAT } from '../../../utils/osmIcons';
import { configIdFromLayerId } from '../../../utils/osmLayerLabels';
import type { InspectedFeature, InspectionResult } from '../../../hooks/useMapFeatureInspect';

export interface FeatureInspectorPanelProps {
  result: InspectionResult;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  onHoverFeature: (feature: InspectedFeature | null) => void;
}

/** The catalog icon for a feature's category. OSM_ICON_BY_CAT holds raw SVG
 *  strings built for map.addImage, not React nodes — safe to inject only
 *  because they are in-repo constants, never OSM-derived text. */
function CategoryIcon({ layerId }: { layerId: string }) {
  const cat = (configIdFromLayerId(layerId) ?? '').split('_').slice(2).join('_');
  const svg = OSM_ICON_BY_CAT[cat]?.svg;
  if (!svg) return <span className="w-3.5 h-3.5 shrink-0 rounded-[2px] bg-rmpg-600" aria-hidden />;
  return <span className="w-3.5 h-3.5 shrink-0" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}

function DetailRows({ feature }: { feature: InspectedFeature }) {
  const d = describeOsmFeature(feature.properties, {
    categoryLabel: feature.categoryLabel,
    groupLabel: feature.groupLabel ?? undefined,
    coverage: feature.coverage,
  });

  return (
    <div className="px-2 py-2 space-y-2">
      <div>
        <div className="text-[12px] font-semibold text-rmpg-100">{d.title}</div>
        <div className="text-[8px] uppercase tracking-wider text-rmpg-400">{d.categoryLabel}</div>
      </div>

      {d.rows.length > 0 && (
        <div className="space-y-[1px]">
          {d.rows.map((r) => (
            <div key={r.key} className="flex gap-2 text-[10px] leading-[1.5]">
              <span className="w-24 shrink-0 text-[color:var(--field-label-color)]">{r.label}</span>
              <span className="text-rmpg-200">{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {d.extras.length > 0 && (
        <div className="pt-1 border-t border-border-default space-y-[1px]">
          {d.extras.map((r) => (
            <div key={r.key} className="flex gap-2 text-[9px] leading-[1.45]">
              <span className="w-24 shrink-0 text-rmpg-500">{r.label}</span>
              <span className="text-rmpg-400">{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {d.coverage && (
        <div className="pt-1 border-t border-border-default text-[8.5px] leading-[1.4] text-rmpg-500">
          {d.coverage}
        </div>
      )}

      {(d.rmpg.verified || d.rmpg.note || d.rmpg.overriddenFields.length > 0) && (
        <div className="pt-1 border-t border-border-default space-y-[2px]">
          {/* The whole point of the edit layer: ground-truthed vs crowd-sourced. */}
          {d.rmpg.verified && (
            <div className="text-[9px] font-bold tracking-wide text-[color:var(--sev-ok)]">
              ✓ RMPG VERIFIED{d.rmpg.verifiedAt ? ` · ${d.rmpg.verifiedAt}` : ''}
            </div>
          )}
          {d.rmpg.note && <div className="text-[10px] leading-[1.45] text-rmpg-200">{d.rmpg.note}</div>}
          {d.rmpg.overriddenFields.length > 0 && (
            // Naming the corrected fields keeps RMPG's value from reading as OSM's.
            <div className="text-[8px] text-rmpg-500">
              Corrected by RMPG: {d.rmpg.overriddenFields.join(', ')}
            </div>
          )}
        </div>
      )}

      <div className="text-[8px] text-rmpg-500">
        Source: OpenStreetMap · extract {d.provenance.extractDate}
        {d.provenance.editedDate ? ` · edited ${d.provenance.editedDate}` : ''}
      </div>
      {d.osmLink && (
        <a href={d.osmLink.url} target="_blank" rel="noopener noreferrer"
           className="block text-[8px] text-brand-gold-400 hover:underline">
          {d.osmLink.id} on openstreetmap.org ↗
        </a>
      )}
    </div>
  );
}

export default function FeatureInspectorPanel({
  result, selectedIndex, onSelect, onClose, onHoverFeature,
}: FeatureInspectorPanelProps) {
  const [lng, lat] = result.lngLat;
  const selected = result.features[selectedIndex];

  return (
    <div className="absolute bottom-4 right-4 z-30 w-[320px] max-h-[60%] flex flex-col
                    bg-surface-raised/95 border border-border-default backdrop-blur-sm overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-default">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--panel-header-color)]">
          {result.features.length === 0
            ? 'Identify'
            : `${result.features.length} feature${result.features.length === 1 ? '' : 's'}`}
        </div>
        <IconButton aria-label="Close feature inspector" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </IconButton>
      </div>

      <div className="px-2 py-1 text-[9px] text-rmpg-500 border-b border-border-default">
        {lng.toFixed(5)}, {lat.toFixed(5)}
        {result.widened && <span className="ml-1">· nearest nearby</span>}
      </div>

      {result.features.length === 0 ? (
        <div className="px-2 py-3 text-[10px] text-rmpg-300">
          No overlay features here. Turn on more overlays, or click closer to a mapped feature.
        </div>
      ) : (
        <div className="flex flex-col overflow-y-auto">
          {result.features.length > 1 && (
            <div className="border-b border-border-default">
              {result.features.map((f, i) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => onSelect(i)}
                  onMouseEnter={() => onHoverFeature(f)}
                  onMouseLeave={() => onHoverFeature(null)}
                  className={`w-full flex items-center gap-2 px-2 py-1 text-left text-[10px]
                    ${i === selectedIndex ? 'bg-surface-sunken text-rmpg-100' : 'text-rmpg-300'}`}
                >
                  <CategoryIcon layerId={f.layerId} />
                  <span className="truncate flex-1">
                    {String(f.properties.name ?? '') || f.categoryLabel}
                  </span>
                  {f.awayLabel && <span className="text-[9px] text-rmpg-500">{f.awayLabel}</span>}
                </button>
              ))}
            </div>
          )}
          {result.features.length === 1 && result.features[0].awayLabel && (
            <div className="px-2 pt-1 text-[9px] text-rmpg-500">{result.features[0].awayLabel}</div>
          )}
          {selected && <DetailRows feature={selected} />}
        </div>
      )}
    </div>
  );
}
```

**Token check — already done, do not re-derive.** Every token above was verified
against `client/tailwind.config.js` and `theme-palettes.css` while writing this
plan: `surface-raised`, `surface-sunken`, `rmpg-100/200/300/400/500/600`,
`brand-gold-400`, `border-border-default`, and `--sev-ok` all exist and are
bound. `IconButton` is a default export. `OSM_ICON_BY_CAT` is keyed by the bare
category name (`hydrant`, `water`, …), which is what the `configIdFromLayerId`
split produces.

A Tailwind class only works if its key is configured — an unbound token emits
**no CSS** and the style silently does nothing. If you add a token beyond the
list above, verify it reaches `dist/assets/*.css` before trusting it.

⚠️ **`brand-gold-400` renders SILVER**, not gold. `--brand-gold` is a deliberate
compat alias that ~500 files consume expecting silver. That is the correct
choice for the OSM link here — a link is not one of gold's two permitted roles —
so **do not "fix" it** to a real gold token.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/FeatureInspectorPanel.test.tsx`
Expected: PASS, 8 tests

- [ ] **Step 5: Typecheck and commit**

```bash
cd client && npx tsc --noEmit
```
Expected: 0 errors.

```bash
git add client/src/pages/map/components/FeatureInspectorPanel.tsx \
        client/src/pages/map/components/__tests__/FeatureInspectorPanel.test.tsx
git commit -m "feat(map): feature inspector panel

Floating list+detail panel for Identify results, rendering from the shared
describeOsmFeature description so it cannot drift from the map's feature-click
popup. Theme tokens throughout; gold restricted to field labels and the panel
header.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Wire the panel, click marker, and hover highlight into the map

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx` (around `:574` and the overlay render block)

**Interfaces:**
- Consumes: `featureInspect.{result, selectedIndex, select, clear}`; `FeatureInspectorPanel`
- Produces: no new exports

- [ ] **Step 1: Add the highlight source and marker effect**

`setFeatureState` is **not** usable here — it needs a stable per-feature `id`
that the OSM pmtiles archives do not guarantee. `queryRenderedFeatures` already
returns WGS84 GeoJSON geometry, so feed a dedicated GeoJSON source instead.

Add near the other map effects in `MapboxMapPage.tsx`:

```tsx
const [hoveredFeature, setHoveredFeature] = useState<InspectedFeature | null>(null);
const inspectMarkerRef = useRef<mapboxgl.Marker | null>(null);

const HIGHLIGHT_SOURCE = 'rmpg-inspect-highlight';

// Highlight the hovered inspector row on the map, so the panel and the
// geometry it describes stay visually tied.
useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapLoaded) return;

  if (!map.getSource(HIGHLIGHT_SOURCE)) {
    map.addSource(HIGHLIGHT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: `${HIGHLIGHT_SOURCE}-line`, type: 'line', source: HIGHLIGHT_SOURCE,
      paint: { 'line-color': '#f0f4f9', 'line-width': 3, 'line-opacity': 0.9 },
    });
    map.addLayer({
      id: `${HIGHLIGHT_SOURCE}-point`, type: 'circle', source: HIGHLIGHT_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#f0f4f9', 'circle-stroke-width': 2,
      },
    });
  }

  const src = map.getSource(HIGHLIGHT_SOURCE) as mapboxgl.GeoJSONSource;
  src?.setData(hoveredFeature
    ? { type: 'Feature', properties: {}, geometry: hoveredFeature.geometry as any }
    : { type: 'FeatureCollection', features: [] });
}, [mapLoaded, hoveredFeature]);
```

Literal hex is correct in Mapbox paint properties — Mapbox cannot resolve
`var()`, and the space-separated `rgb(r g b)` form blanks the map.

- [ ] **Step 2: Drop a marker at the clicked point**

```tsx
// A panel puts the answer away from the point the officer clicked; the marker
// is what keeps the two connected.
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  inspectMarkerRef.current?.remove();
  inspectMarkerRef.current = null;
  if (!featureInspect.result) return;
  inspectMarkerRef.current = new mapboxgl.Marker({ color: '#c3ccd6' })
    .setLngLat(featureInspect.result.lngLat)
    .addTo(map);
  return () => { inspectMarkerRef.current?.remove(); inspectMarkerRef.current = null; };
}, [featureInspect.result]);
```

- [ ] **Step 3: Render the panel**

In the map overlay JSX, alongside the other floating panels:

```tsx
{featureInspect.enabled && featureInspect.result && (
  <FeatureInspectorPanel
    result={featureInspect.result}
    selectedIndex={featureInspect.selectedIndex}
    onSelect={featureInspect.select}
    onClose={featureInspect.clear}
    onHoverFeature={setHoveredFeature}
  />
)}
```

Add the imports:

```tsx
import FeatureInspectorPanel from './components/FeatureInspectorPanel';
import type { InspectedFeature } from '../../hooks/useMapFeatureInspect';
```

- [ ] **Step 4: Typecheck and build**

```bash
cd client && npx tsc --noEmit && npx vite build
```
Expected: 0 errors; build succeeds.

- [ ] **Step 5: Verify in a real browser**

jsdom has no layout engine, so the tests above prove content and wiring but say
**nothing** about whether the panel is positioned correctly or scrolls. This
step is not optional.

Start the dev server via the preview tooling (never `npm run dev` in Bash), then:
1. Enable Identify from the map toolbar.
2. Click a school with the Sites overlay on — expect **one** row, not twelve, and the detail visible without a second click.
3. Click empty desert — expect "No overlay features here".
4. Click a few pixels off a hydrant — expect the hydrant with a `NN ft <bearing>` label.
5. With 2+ hits, hover each row — expect the map highlight to move.
6. Confirm the panel does not overflow the map container and its body scrolls internally.

Capture a screenshot of case 2 as the before/after evidence.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire the feature inspector panel into the map

Renders the inspector for Identify results, drops a marker at the clicked
point, and highlights the hovered row's geometry via a GeoJSON source.
setFeatureState is not usable here: it needs a stable per-feature id the OSM
pmtiles archives do not guarantee.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Full-gate verification

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Client tests, serially**

Run: `cd client && npx vitest run`
Expected: all green. Do **not** run the root suite at the same time — concurrent
runs fake ~9 timeout failures.

- [ ] **Step 2: Worker suite**

Run: `npx vitest run`
Expected: all green. Nothing in this change touches `/src/`, so a failure here
means contention or a pre-existing flake — re-run serially before investigating.

- [ ] **Step 3: Client typecheck and build**

```bash
cd client && npx tsc --noEmit && npx vite build
```
Expected: 0 errors; build succeeds.

- [ ] **Step 4: Confirm the Tilequery call is gone**

```bash
grep -rn "mapboxTilequery" client/src | grep -v services/mapboxApiService
```
Expected: **no output.** The service export itself stays in place and unused —
widening this change into the API service layer is explicitly out of scope.

- [ ] **Step 5: Confirm no hex crept into the new React component**

```bash
grep -nE "#[0-9a-fA-F]{3,8}\b" client/src/pages/map/components/FeatureInspectorPanel.tsx
```
Expected: **no output.** Hex in `MapboxMapPage.tsx` paint properties is correct
and expected; hex in the panel is not.

- [ ] **Step 6: Open the PR**

```bash
gh pr create -R rmpgutah/rmpg-flex --base main \
  --title "feat(map): overlays-only feature inspector" \
  --body "$(cat <<'EOF'
## Summary

A click on a school in the Identify tool returned twelve rows — one school and
eleven rows of basemap geometry and internal render layer ids, including a raw
`rmpg-coverage-gaps-fill`. It now returns one.

- Filters hits through the existing `isOverlayLayer` predicate; dedupes by `osm_id`; ranks by catalog order
- Replaces the popup with a floating list+detail panel
- Extracts a pure `describeOsmFeature()` so the panel and the existing feature-click popup render from one description — the field table and unit conversions live in exactly one place
- Drops the Tilequery call: it queried `mapbox-streets-v8`, the basemap tileset, which contains none of our overlays, so every row it returned was discarded. A billed round-trip per click that answered nothing.
- Adds a nearest-feature fallback so a near-miss on a hydrant is not reported as "no hydrant"

Spec: `docs/superpowers/specs/2026-08-02-features-overlay-inspector-design.md`

## Testing

- `osmPopup.test.ts` passes **unmodified** — proof the refactor changed no rendering
- New: value-level tests for `describeOsmFeature`, a regression test feeding the hook the exact twelve layers from the reported screenshot and asserting one result, and panel render tests
- Client suite, client typecheck, and `vite build` all green
- Verified in a real browser (jsdom has no layout engine): panel position, internal scroll, hover highlight, and all four click cases

Note: the PR template's "Server (Express/SQLite)" section is VPS-era and does not apply.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:** Overlays-only filter → Task 2. Floating panel placement →
Tasks 4–5. List + selected detail → Task 4. Description extraction and the
escaping invariant → Task 1. 8px box, dedupe, catalog ranking → Task 2.
No distance on the normal path → Task 3 (asserted). Widen-then-report empty
state → Task 3. Marker and hover highlight → Task 5. Deletions → Tasks 2 and 6
(grep-verified). Testing section → Tasks 1–4, gates in Task 6. Out-of-scope
items are excluded and none are touched.

**Deviation from the spec, corrected in the spec:** hover highlight uses a
GeoJSON source, not `setFeatureState`, because the latter requires a per-feature
`id` the OSM archives do not guarantee. The spec was updated to match.

**Type consistency:** `InspectedFeature` and `InspectionResult` are defined in
Task 2 and consumed unchanged in Tasks 3–5. `describeOsmFeature`,
`DescriptionRow`, and `FeatureDescription` are defined in Task 1 and consumed in
Task 4. `awayLabel` is introduced as optional in Task 2 and populated in Task 3,
so Task 2's tests remain valid. `selectedIndex`/`select` are returned by the
hook in Task 2 and consumed in Tasks 4–5.
