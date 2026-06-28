# Mapbox Visual Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brand every Mapbox surface in the app with the pure-black/`#d4a017` gold Spillman theme and give all surfaces consistent markers, via two shared modules wired into each map.

**Architecture:** A runtime basemap restyler (`applyRmpgBasemap`) recolors the stock Mapbox style's layers on the `style.load` event — no Mapbox Studio asset needed. A shared marker-builder module (`mapMarkers.ts`) replaces each surface's hand-rolled DOM markers. Five surfaces get thin wiring: a `style.load` hook + swapped marker builders.

**Tech Stack:** Mapbox GL JS, React 18 + TypeScript, Vite, vitest (client suite via `cd client && npx vitest run`).

**Spec:** `docs/superpowers/specs/2026-06-14-mapbox-visual-upgrade-design.md`

---

## File Structure

- **Create** `client/src/utils/mapMarkers.ts` — pure DOM marker builders (`buildUnitMarker`, `buildCallMarker`, `buildDotMarker`) + status/priority color maps. No Mapbox import.
- **Create** `client/src/utils/__tests__/mapMarkers.test.ts` — vitest for the builders.
- **Create** `client/src/utils/mapboxBasemap.ts` — `applyRmpgBasemap(map, opts)` runtime restyler, guarded against missing layers.
- **Modify** `client/src/pages/map/MapPage.tsx` — hook `applyRmpgBasemap` on `style.load`.
- **Modify** `client/src/components/SightingsMap.tsx` — `style.load` hook + `buildDotMarker`.
- **Modify** `client/src/components/DispatchMiniMap.tsx` — `style.load` hook + `buildUnitMarker`/`buildCallMarker`.
- **Modify** `client/src/components/ForensicTrackMap.tsx` — `style.load` hook + `buildDotMarker`.
- **Modify** `client/src/components/NavMapView.tsx` — `style.load` hook (main + inset).
- **Modify** `client/public/sw.js` — bump `CACHE_NAME`.

> Note: `client` vitest config resolves `__tests__` next to source. Confirm with an existing example: `ls client/src/**/__tests__ 2>/dev/null | head`. If the repo convention is `client/src/utils/*.test.ts` colocated instead, create the test there. Run `git ls-files 'client/src/**/*.test.ts' | head` in Step 0 to confirm the convention before creating the test file.

---

## Task 0: Confirm test-file convention

- [ ] **Step 1: Find where client tests live**

Run:
```bash
cd "client" && git ls-files 'src/**/*.test.ts' 'src/**/*.test.tsx' | head
```
Expected: a list of existing test files. Use whichever directory convention dominates (colocated `foo.test.ts` next to `foo.ts`, OR `__tests__/foo.test.ts`). Use that convention for the test path in Task 1. If both appear, prefer colocated `client/src/utils/mapMarkers.test.ts`.

---

## Task 1: Shared marker builders (`mapMarkers.ts`)

**Files:**
- Create: `client/src/utils/mapMarkers.ts`
- Test: `client/src/utils/mapMarkers.test.ts` (or `__tests__/mapMarkers.test.ts` per Task 0)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  buildUnitMarker,
  buildCallMarker,
  buildDotMarker,
  unitStatusColor,
  callPriorityColor,
} from './mapMarkers';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "client" && npx vitest run src/utils/mapMarkers.test.ts`
Expected: FAIL — "Cannot find module './mapMarkers'".

- [ ] **Step 3: Write minimal implementation**

```ts
// client/src/utils/mapMarkers.ts
// Shared, themed Mapbox marker builders. Pure DOM — no Mapbox coupling;
// callers wrap the returned element in `new mapboxgl.Marker({ element })`.
// Theme tokens mirror client/src/index.css :root (pure-black / gold Spillman).

export type UnitStatus =
  | 'in_service' | 'available' | 'enroute' | 'onscene' | 'busy'
  | 'out_of_service' | string;

const GOLD = '#d4a017';
const GREEN = '#22c55e';
const RED = '#dc2626';
const NEUTRAL = '#888888';

export function unitStatusColor(status: UnitStatus | undefined): string {
  switch (status) {
    case 'in_service':
    case 'available':
      return GREEN;
    case 'enroute':
    case 'onscene':
    case 'busy':
      return GOLD;
    case 'out_of_service':
      return NEUTRAL;
    default:
      return NEUTRAL;
  }
}

export function callPriorityColor(priority: number | string | undefined): string {
  if (priority === undefined || priority === null) return GOLD;
  const p = typeof priority === 'string' ? parseInt(priority, 10) : priority;
  if (Number.isNaN(p)) return GOLD;
  if (p <= 2) return RED;
  if (p <= 4) return GOLD;
  return NEUTRAL;
}

export interface UnitMarkerOpts {
  label?: string;
  status?: UnitStatus;
  heading?: number;
}

/** Clean circular unit marker with status-colored ring + centered label. */
export function buildUnitMarker(opts: UnitMarkerOpts): HTMLElement {
  const color = unitStatusColor(opts.status);
  const el = document.createElement('div');
  el.style.cssText = [
    'width:22px', 'height:22px', 'border-radius:50%',
    'background:#000000', `border:2px solid ${color}`,
    `box-shadow:0 0 6px ${color}, 0 1px 3px rgba(0,0,0,0.6)`,
    'display:flex', 'align-items:center', 'justify-content:center',
    'font-family:"JetBrains Mono",monospace', 'font-size:10px',
    'font-weight:700', 'color:#fff', 'cursor:pointer',
  ].join(';');
  if (opts.label) {
    const span = document.createElement('span');
    span.textContent = opts.label;       // text node — no HTML injection
    el.appendChild(span);
  }
  if (typeof opts.heading === 'number') {
    const arrow = document.createElement('div');
    arrow.style.cssText = [
      'position:absolute', 'top:-6px', 'left:50%',
      'transform:translateX(-50%)',
      'width:0', 'height:0',
      'border-left:4px solid transparent',
      'border-right:4px solid transparent',
      `border-bottom:6px solid ${color}`,
    ].join(';');
    el.style.position = 'relative';
    el.appendChild(arrow);
    el.style.transform = `rotate(${opts.heading}deg)`;
  }
  return el;
}

export interface CallMarkerOpts {
  priority?: number | string;
  label?: string;
}

/** Priority-colored teardrop call marker. */
export function buildCallMarker(opts: CallMarkerOpts): HTMLElement {
  const color = callPriorityColor(opts.priority);
  const el = document.createElement('div');
  el.style.cssText = [
    'width:20px', 'height:20px',
    'background:' + color,
    'border:1.5px solid #000000',
    'border-radius:50% 50% 50% 0',
    'transform:rotate(-45deg)',
    'box-shadow:0 2px 4px rgba(0,0,0,0.6)',
    'cursor:pointer',
  ].join(';');
  if (opts.label) {
    const span = document.createElement('span');
    span.textContent = opts.label;
    span.style.cssText = 'display:block;transform:rotate(45deg);text-align:center;font-size:9px;font-weight:700;color:#000;line-height:20px;';
    el.appendChild(span);
  }
  return el;
}

export interface DotMarkerOpts {
  color?: string;
  size?: number;
  pulse?: boolean;
}

/** Simple colored dot for sightings / track points. */
export function buildDotMarker(opts: DotMarkerOpts): HTMLElement {
  const color = opts.color || GOLD;
  const size = opts.size ?? 10;
  const el = document.createElement('div');
  el.style.cssText = [
    `width:${size}px`, `height:${size}px`, 'border-radius:50%',
    `background:${color}`, 'border:1px solid #000000',
    `box-shadow:0 0 4px ${color}`,
  ].join(';');
  if (opts.pulse) el.style.animation = 'rmpg-recovery-pulse 1.4s ease-in-out infinite';
  return el;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "client" && npx vitest run src/utils/mapMarkers.test.ts`
Expected: PASS (all suites green).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/mapMarkers.ts client/src/utils/mapMarkers.test.ts
git commit -m "feat(map): shared themed marker builders"
```

---

## Task 2: Runtime basemap restyler (`mapboxBasemap.ts`)

**Files:**
- Create: `client/src/utils/mapboxBasemap.ts`

No unit test — this requires a live GL style. It is hardened to never throw on a
missing layer, and verified manually in Task 5.

- [ ] **Step 1: Write the implementation**

```ts
// client/src/utils/mapboxBasemap.ts
// Runtime re-skin of a stock Mapbox style into the RMPG pure-black/gold theme.
// Call on the map's `style.load` event so it re-applies after every style swap.
// Every mutation is guarded: a layer missing from a given stock style is skipped,
// never thrown — the restyler must never blank the map.

import type mapboxgl from 'mapbox-gl';

export type BasemapVariant = 'dark' | 'satellite' | 'light';

const GOLD = '#d4a017';

function setPaint(map: mapboxgl.Map, id: string, prop: string, value: unknown): void {
  try {
    if (map.getLayer(id)) map.setPaintProperty(id, prop as never, value as never);
  } catch { /* layer absent or prop invalid for this style — skip */ }
}

function setLayout(map: mapboxgl.Map, id: string, prop: string, value: unknown): void {
  try {
    if (map.getLayer(id)) map.setLayoutProperty(id, prop as never, value as never);
  } catch { /* skip */ }
}

/** Apply theme to a layer id matched by substring across all style layers. */
function forEachLayer(
  map: mapboxgl.Map,
  match: (id: string, type: string) => boolean,
  apply: (id: string, type: string) => void,
): void {
  let layers: mapboxgl.AnyLayer[] = [];
  try {
    layers = (map.getStyle()?.layers ?? []) as mapboxgl.AnyLayer[];
  } catch { return; }
  for (const layer of layers) {
    const id = layer.id;
    const type = (layer as { type?: string }).type ?? '';
    try { if (match(id, type)) apply(id, type); } catch { /* skip */ }
  }
}

function applyDark(map: mapboxgl.Map): void {
  // Background / land
  setPaint(map, 'background', 'background-color', '#000000');
  forEachLayer(map,
    (id, type) => type === 'background' || /land|landcover|landuse|national-park|park/i.test(id),
    (id, type) => {
      if (type === 'fill') setPaint(map, id, 'fill-color', '#0b0b0b');
      if (type === 'background') setPaint(map, id, 'background-color', '#000000');
    });

  // Water → near-black, zero blue
  forEachLayer(map, (id) => /water|ocean|river|bathymetry/i.test(id),
    (id, type) => {
      if (type === 'fill') setPaint(map, id, 'fill-color', '#050608');
      if (type === 'line') setPaint(map, id, 'line-color', '#050608');
    });

  // Roads — muted, with gold major arterials
  forEachLayer(map, (id, type) => type === 'line' && /road|street|bridge|tunnel|motorway|trunk|primary|secondary/i.test(id),
    (id) => {
      if (/motorway|trunk|primary/i.test(id)) {
        setPaint(map, id, 'line-color', GOLD);
        setPaint(map, id, 'line-opacity', 0.55);
      } else if (/secondary|tertiary/i.test(id)) {
        setPaint(map, id, 'line-color', '#262626');
      } else {
        setPaint(map, id, 'line-color', '#1a1a1a');
      }
    });

  // Admin / boundaries
  forEachLayer(map, (id, type) => type === 'line' && /admin|boundary/i.test(id),
    (id) => setPaint(map, id, 'line-color', '#232323'));

  // Labels: gold major, neutral minor, black halo; hide POI noise
  forEachLayer(map, (id, type) => type === 'symbol',
    (id) => {
      if (/poi|transit|airport|natural-point/i.test(id)) {
        setLayout(map, id, 'visibility', 'none');
        return;
      }
      setPaint(map, id, 'text-halo-color', '#000000');
      setPaint(map, id, 'text-halo-width', 1.2);
      if (/motorway|trunk|primary|place-(city|town)|settlement-major/i.test(id)) {
        setPaint(map, id, 'text-color', GOLD);
      } else {
        setPaint(map, id, 'text-color', '#888888');
      }
    });
}

function applySatellite(map: mapboxgl.Map): void {
  // Leave imagery; just make overlay roads/labels legible & on-brand.
  forEachLayer(map, (id, type) => type === 'line' && /road|motorway|trunk|primary/i.test(id),
    (id) => { if (/motorway|trunk|primary/i.test(id)) setPaint(map, id, 'line-color', GOLD); });
  forEachLayer(map, (id, type) => type === 'symbol',
    (id) => {
      setPaint(map, id, 'text-halo-color', '#000000');
      setPaint(map, id, 'text-halo-width', 1.4);
      setPaint(map, id, 'text-color', '#ffffff');
    });
}

/** Re-skin the loaded style. Safe to call repeatedly and on any stock style. */
export function applyRmpgBasemap(
  map: mapboxgl.Map | null | undefined,
  opts?: { variant?: BasemapVariant },
): void {
  if (!map) return;
  const variant = opts?.variant ?? 'dark';
  try {
    if (variant === 'satellite') applySatellite(map);
    else if (variant === 'dark') applyDark(map);
    // 'light' = print path: intentionally minimal, leave stock light style as-is.
  } catch { /* never throw from a cosmetic restyle */ }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "client" && npx tsc --noEmit`
Expected: PASS (no type errors introduced).

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/mapboxBasemap.ts
git commit -m "feat(map): runtime branded basemap restyler"
```

---

## Task 3: Wire restyler into MapPage

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx` (map init near line 1355; style switch effect near line 1552)

- [ ] **Step 1: Add the import**

Near the other `../../utils/mapbox*` imports at the top of MapPage.tsx, add:
```ts
import { applyRmpgBasemap, type BasemapVariant } from '../../utils/mapboxBasemap';
```

- [ ] **Step 2: Add a variant helper**

Find where `mapStyle` is declared (line ~359). Immediately after the existing
`isLightMapStyle` / `isSatelliteStyle` helpers are used, add a local mapper.
Place this near the top of the component body (after `mapStyle` state):
```ts
const basemapVariant: BasemapVariant =
  isSatelliteStyle(mapStyle) ? 'satellite'
  : isLightMapStyle(mapStyle) ? 'light'
  : 'dark';
```
> If `isSatelliteStyle`/`isLightMapStyle` are imported helpers (they are used at
> lines 591/658/3820), reuse them as-is. Do not redefine.

- [ ] **Step 3: Hook `style.load` at map init**

Immediately after `registerMapInstance(map);` (line ~1358), add:
```ts
      // Re-skin every (re)loaded style into the RMPG pure-black/gold theme.
      map.on('style.load', () => applyRmpgBasemap(map, { variant: basemapVariantRef.current }));
```
Because `basemapVariant` is recomputed each render, capture it in a ref so the
long-lived `style.load` listener always reads the current value. Add near the
other refs (e.g. beside `mapInstanceRef`):
```ts
  const basemapVariantRef = useRef<BasemapVariant>('dark');
```
and keep it current — add an effect (near the style-switch effect ~1552):
```ts
  useEffect(() => { basemapVariantRef.current = basemapVariant; }, [basemapVariant]);
```

- [ ] **Step 4: Re-apply after explicit setStyle**

The style-switch effect (line ~1552) calls `map.setStyle(url)`. `setStyle` fires
`style.load` when the new style finishes, so the listener from Step 3 already
re-applies — no change needed there. Verify by reading lines 1550-1558 and
confirming a `style.load` listener (not a one-shot `once('load')`) handles it.

- [ ] **Step 5: Typecheck**

Run: `cd "client" && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapPage.tsx
git commit -m "feat(map): apply branded basemap on MapPage style load"
```

---

## Task 4: Wire smaller surfaces (restyler + shared markers)

**Files:**
- Modify: `client/src/components/SightingsMap.tsx` (init ~48, marker ~82)
- Modify: `client/src/components/DispatchMiniMap.tsx` (init ~142, markers ~196/241/287)
- Modify: `client/src/components/ForensicTrackMap.tsx` (init ~41, markers ~52/55)
- Modify: `client/src/components/NavMapView.tsx` (main init ~141, inset ~399)

- [ ] **Step 1: SightingsMap — restyler + dot markers**

Add import: `import { applyRmpgBasemap } from '../utils/mapboxBasemap';`
and `import { buildDotMarker } from '../utils/mapMarkers';`
After `const map = new mapboxgl.Map({...})` (line ~48), add:
```ts
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
```
Replace the hand-built marker element block at line ~82 (the `document.createElement('div')` + inline `el.style.cssText`) with:
```ts
      const el = buildDotMarker({ color: s.color || '#d4a017', size: 11 });
```
> Preserve any existing per-sighting color variable (`s.color` or equivalent) —
> read lines 78-90 first and pass the real color expression into `buildDotMarker`.

- [ ] **Step 2: DispatchMiniMap — restyler + unit/call markers**

Add the same two imports. After `new mapboxgl.Map` (line ~142):
```ts
      map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
```
- Call marker (~196): replace the `createElement` block with `const el = buildCallMarker({ priority: <existing priority expr>, label: <existing label or undefined> });`
- Unit markers (~241, ~287): replace with `const el = buildUnitMarker({ label: <existing unit label>, status: <existing status expr> });`
> Read lines 190-300 first; map each existing inline-styled element to the
> matching builder, passing the real label/status/priority expressions already
> in scope. Keep the surrounding `new mapboxgl.Marker({ element: el, anchor })` calls.

- [ ] **Step 3: ForensicTrackMap — restyler + dot markers**

Add imports. The map uses `map.on('load', ...)` (line ~44). Change/add a
`style.load` hook right after the `new mapboxgl.Map(...)` on line 41:
```ts
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
```
Replace the inline `mk` dot helper (line ~52) body's element creation with
`const el = buildDotMarker({ color, size: 10 });` (keep the `color` param).
The position marker at ~55 may stay bespoke (directional) — leave if it carries
rotation; otherwise convert to `buildDotMarker`.

- [ ] **Step 4: NavMapView — restyler on main + inset**

Add `import { applyRmpgBasemap } from '../utils/mapboxBasemap';`
Main map (init ~141) already has `map.on('load', ...)` at 162 — ADD a separate:
```ts
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
```
Inset map (init ~399, `inset.on('load')` at 409) — add:
```ts
      inset.on('style.load', () => applyRmpgBasemap(inset, { variant: 'dark' }));
```
> NavMapView is theme-aware (line 131 comment). If a non-dark style can be
> selected here, derive the variant from the same signal used for `initialUrl`
> instead of hardcoding `'dark'`. Read lines 125-165 to confirm; hardcode `'dark'`
> only if the surface is always dark.

- [ ] **Step 5: Typecheck**

Run: `cd "client" && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/SightingsMap.tsx client/src/components/DispatchMiniMap.tsx client/src/components/ForensicTrackMap.tsx client/src/components/NavMapView.tsx
git commit -m "feat(map): brand basemap + shared markers across mini/nav/sightings/track maps"
```

---

## Task 5: SW bump + full verification + PR

**Files:**
- Modify: `client/public/sw.js` (`CACHE_NAME`)

- [ ] **Step 1: Bump the service-worker cache name**

Read the current value: `grep -n "CACHE_NAME" client/public/sw.js`
Increment the version (e.g. `rmpg-flex-vNNN` → `vNNN+1`).

- [ ] **Step 2: Full client verification gate**

Run each and confirm PASS:
```bash
cd "client" && npx tsc --noEmit
cd "client" && npx vitest run
cd "client" && npx vite build
```
Expected: typecheck clean, all vitest green (incl. new mapMarkers tests), build succeeds.

- [ ] **Step 3: Manual visual check (browser)**

Per CLAUDE.md the WAF blocks curl; open the running app in a real browser
(`cd client && npm run dev`, then http://localhost:5173/map). Verify:
- Dark basemap is pure-black with gold major roads, no blue water, no POI clutter.
- Toggle dark → satellite → dark: branding re-applies each switch (no flash of
  stock grey persisting).
- Unit/call/sighting markers render consistently and legibly.

- [ ] **Step 4: Commit the SW bump**

```bash
git add client/public/sw.js
git commit -m "chore: bump SW cache for map visual upgrade"
```

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create --title "Map visual upgrade: branded basemap + shared markers" \
  --body "Brands all five Mapbox surfaces (MapPage, DispatchMiniMap, NavMapView, SightingsMap, ForensicTrackMap) with the pure-black/gold theme via a shared runtime restyler, and unifies markers via a shared builder module. Phase A+B of the map upgrade; control-UI declutter (Phase C) deferred. Spec + plan under docs/superpowers/. No migrations, no Worker change."
```
Expected: PR opened; pr-tests.yml runs. User reviews and merges (deploy.yml ships Pages).

---

## Self-Review Notes

- **Spec coverage:** branded basemap (Task 2+3+4), zero-blue water (applyDark water block), gold arterials (applyDark roads), decluttered POI (applyDark symbol `visibility:none`), shared markers (Task 1, adopted Task 4), one shared seam surviving style switches (Task 3 `style.load` + ref), tests (Task 1 vitest), SW bump (Task 5). All covered.
- **No placeholders:** every code step shows full code; surface-wiring steps include "read lines N-M first" because the exact in-scope label/status/priority variable names must be read from each file rather than guessed — the builder call signature is fully specified.
- **Type consistency:** `applyRmpgBasemap(map, { variant })`, `BasemapVariant`, `buildUnitMarker/buildCallMarker/buildDotMarker`, `unitStatusColor/callPriorityColor` are named identically across all tasks.
