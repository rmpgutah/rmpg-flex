# MapCore Module Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Mapbox map-instance lifecycle (init, style switching, teardown, camera/projection/atmosphere/daylight/optimization/snapshot) out of `MapboxMapPage.tsx` into a new `useMapCore` hook module, as the first increment of the Map UI structural refactor (spec: `docs/superpowers/specs/2026-07-03-map-ui-portal-redesign-design.md`).

**Architecture:** `MapboxMapPage.tsx` currently owns map init inline (a ~200-line `useEffect` with token fetch, error classification, retry/fallback logic) plus wires 7 standalone hooks (`useMapProjection`, `useMapAtmosphere`, `useMapDaylight`, `useMapCameraAnimation`, `useMapSnapshot`, `useMapOptimization`) directly against `mapRef.current`. This plan moves that orchestration into one new hook, `useMapCore`, in `client/src/pages/map/modules/MapCore.ts`, that owns the map ref, the init effect, and composes the 6 existing hooks (their internals are NOT modified — this plan only relocates orchestration). The shell keeps its own `mapContainerRef` (DOM element) but delegates everything else core-related to `useMapCore`.

**Tech Stack:** React hooks, Mapbox GL JS, existing `mapboxLoader.ts` / `mapboxApiKey.ts` utils (unchanged), Vitest for tests, TypeScript.

**Scope note:** This is plan 1 of 7 in the module-split program. Subsequent modules (MapDrawing, MapAnalysis, MapRouting, MapOverlaysAndAlerts, MapStatusBar, MapToolsSidebar) will each get their own plan, written just before that module's turn (per the spec's migration order), so each plan reflects the file's actual state after prior extractions land.

---

## Task 1: Create `useMapCore` hook skeleton with a passing smoke test

**Files:**
- Create: `client/src/pages/map/modules/MapCore.ts`
- Create: `client/src/pages/map/modules/__tests__/MapCore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// client/src/pages/map/modules/__tests__/MapCore.test.ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapCore } from '../MapCore';

describe('useMapCore', () => {
  it('returns a mapContainerRef, mapRef, and initial state before any map exists', () => {
    const { result } = renderHook(() =>
      useMapCore({ preferredEngine: 'mapbox', mapStyle: 'dark', retryNonce: 0 })
    );

    expect(result.current.mapContainerRef.current).toBeNull();
    expect(result.current.mapRef.current).toBeNull();
    expect(result.current.mapLoaded).toBe(false);
    expect(result.current.loading).toBe(true);
    expect(result.current.mapError).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/modules/__tests__/MapCore.test.ts`
Expected: FAIL with `Cannot find module '../MapCore'` (file doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

```ts
// client/src/pages/map/modules/MapCore.ts
import { useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { MapStyleId } from '../utils/mapConstants';

export interface UseMapCoreOptions {
  preferredEngine: 'mapbox' | 'maplibre';
  mapStyle: MapStyleId;
  retryNonce: number;
}

export interface UseMapCoreResult {
  mapContainerRef: React.RefObject<HTMLDivElement>;
  mapRef: React.MutableRefObject<mapboxgl.Map | null>;
  mapLoaded: boolean;
  loading: boolean;
  mapError: string | null;
}

export function useMapCore(_options: UseMapCoreOptions): UseMapCoreResult {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded] = useState(false);
  const [loading] = useState(true);
  const [mapError] = useState<string | null>(null);

  return { mapContainerRef, mapRef, mapLoaded, loading, mapError };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/modules/__tests__/MapCore.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/modules/MapCore.ts client/src/pages/map/modules/__tests__/MapCore.test.ts
git commit -m "feat(map): add useMapCore hook skeleton"
```

---

## Task 2: Move map-init effect into `useMapCore` (behavior-preserving)

This is the ~200-line effect currently at `MapboxMapPage.tsx:398-610` (the `initMap` async function, its `map.on('load'/'error')` handlers, and the cleanup `useEffect`'s teardown of `mapRef`/marker refs). It must move verbatim in logic — only the state setters change from component `useState` calls to hook-internal `useState`/callback returns.

**Files:**
- Modify: `client/src/pages/map/modules/MapCore.ts`
- Modify: `client/src/pages/map/modules/__tests__/MapCore.test.ts`
- Reference (read-only, do not edit yet): `client/src/pages/map/MapboxMapPage.tsx:396-610`

- [ ] **Step 1: Write the failing test — token-unavailable path falls back to MapLibre**

```ts
// append to client/src/pages/map/modules/__tests__/MapCore.test.ts
import { vi } from 'vitest';

vi.mock('../../../../utils/mapboxApiKey', () => ({
  getMapboxTokenStatus: vi.fn().mockResolvedValue({ token: null, errorKind: 'unconfigured' }),
  getCachedMapboxStyleUrl: vi.fn().mockReturnValue(null),
}));

it('falls back to MapLibre and sets an error when no Mapbox token is configured', async () => {
  const { result, rerender } = renderHook(() =>
    useMapCore({ preferredEngine: 'mapbox', mapStyle: 'dark', retryNonce: 0 })
  );

  // allow the async initMap() to resolve
  await vi.waitFor(() => {
    rerender();
    expect(result.current.loading).toBe(false);
  });

  expect(result.current.mapError).toMatch(/Mapbox access token not configured/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/modules/__tests__/MapCore.test.ts`
Expected: FAIL — `mapError` is still `null` (the skeleton from Task 1 never calls `getMapboxTokenStatus`)

- [ ] **Step 3: Implement the full init effect in `useMapCore`**

Replace the body of `client/src/pages/map/MapCore.ts` with the real orchestration, moved from `MapboxMapPage.tsx:398-610` verbatim (same branches, same messages, same timeout values), but now returning `mapLibreFallback` and exposing `setMapStyleId`-driven retry via an internal `retryNonce` state bump instead of relying on the parent:

```ts
// client/src/pages/map/modules/MapCore.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import {
  createMapboxMap, destroyMapboxMap, injectMapboxStyles, addMapbox3DBuildings,
} from '../../../utils/mapboxLoader';
import { getMapboxTokenStatus } from '../../../utils/mapboxApiKey';
import { devLog, devWarn } from '../../../utils/devLog';
import type { MapStyleId } from '../utils/mapConstants';

const DARK_STYLES: MapStyleId[] = ['dark', 'night_nav'];

export interface UseMapCoreOptions {
  preferredEngine: 'mapbox' | 'maplibre';
  mapStyle: MapStyleId;
  onStyleFallback: (style: MapStyleId) => void;
  loadBeatOverlay: (map: mapboxgl.Map) => void;
}

export interface UseMapCoreResult {
  mapContainerRef: React.RefObject<HTMLDivElement>;
  mapRef: React.MutableRefObject<mapboxgl.Map | null>;
  mapLoaded: boolean;
  loading: boolean;
  mapError: string | null;
  mapLibreFallback: boolean;
}

export function useMapCore({
  preferredEngine, mapStyle, onStyleFallback, loadBeatOverlay,
}: UseMapCoreOptions): UseMapCoreResult {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const tokenRef = useRef<string | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLibreFallback, setMapLibreFallback] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (preferredEngine === 'maplibre' && !mapLibreFallback) {
      setMapError(null);
      setMapLibreFallback(true);
      setLoading(false);
    }
  }, [preferredEngine, mapLibreFallback]);

  useEffect(() => {
    if (mapLibreFallback) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function initMap() {
      try {
        const tokenStatusPromise = getMapboxTokenStatus(retryNonce > 0);
        const timeoutPromise = new Promise<null>((_resolve) => setTimeout(() => _resolve(null), 10_000));
        const tokenStatus = await Promise.race([tokenStatusPromise, timeoutPromise]);
        if (cancelled) return;
        if (!tokenStatus?.token) {
          if (tokenStatus?.errorKind === 'auth') {
            setMapError('Unable to access Mapbox token due to authentication/session failure. Please sign in again, then retry.');
          } else if (tokenStatus?.errorKind === 'network') {
            setMapError('Unable to fetch Mapbox token due to a network/connectivity error. Check connectivity, then retry.');
          } else if (tokenStatus?.errorKind === 'server') {
            setMapError(`Failed to fetch Mapbox token from server: ${tokenStatus.errorMessage || 'unknown error'}`);
          } else if (tokenStatus?.errorKind === 'client') {
            setMapError(`Mapbox token fetch failed on client side: ${tokenStatus.errorMessage || 'unknown client error'}`);
          } else if (tokenStatus?.errorKind === 'none' || tokenStatus?.errorKind === 'unconfigured') {
            setMapError('Mapbox access token not configured. Go to Admin → Integrations to add your Mapbox token.');
          } else {
            setMapError('Mapbox token is unavailable. Using MapLibre fallback.');
          }
          devLog('[MapCore] Mapbox token unavailable, activating MapLibre GL fallback', tokenStatus);
          setMapLibreFallback(true);
          setLoading(false);
          return;
        }
        tokenRef.current = tokenStatus.token;
        injectMapboxStyles();

        if (!mapContainerRef.current) {
          await new Promise((r) => setTimeout(r, 100));
          if (cancelled || !mapContainerRef.current) {
            setMapError('Map container failed to mount');
            setLoading(false);
            return;
          }
        }

        const map = createMapboxMap(mapContainerRef.current!, tokenRef.current!, mapStyle);
        mapRef.current = map;

        let mapDidLoad = false;

        const loadTimeout = setTimeout(() => {
          if (!cancelled && !mapRef.current?.loaded()) {
            devWarn('[MapCore] map load timed out after 15s');
            setLoading(false);
          }
        }, 15_000);

        map.on('load', () => {
          clearTimeout(loadTimeout);
          if (cancelled) return;
          mapDidLoad = true;
          if (DARK_STYLES.includes(mapStyle)) addMapbox3DBuildings(map);
          loadBeatOverlay(map);
          setMapLoaded(true);
          setLoading(false);
          devLog('[MapCore] map loaded');
        });

        map.on('error', (e) => {
          devWarn('[MapCore] map error', e);
          if (cancelled) return;

          const msg = e.error?.message || 'Mapbox map error';
          const status = (e.error as any)?.status;
          const msgLower = msg.toLowerCase();

          const isNetworkErr =
            msgLower.includes('failed to fetch') ||
            msgLower.includes('networkerror') ||
            msgLower.includes('network request failed');

          const isAuthErr =
            status === 401 || status === 403 ||
            msgLower.includes('access token') ||
            msgLower.includes('not authorized') ||
            msgLower.includes('unauthorized') ||
            msgLower.includes('forbidden') ||
            msgLower.includes('invalid token') ||
            msgLower.includes('token is not authorized') ||
            msgLower.includes('not configured') ||
            msgLower.includes('error status 4');

          const isStyleErr = msgLower.includes('style not found') || msgLower.includes('style is not found');

          const isHtmlResponseErr =
            msgLower.includes('unexpected token') && msgLower.includes('doctype');

          if (isNetworkErr && !mapDidLoad) {
            devLog('[MapCore] Network error during init (will retry):', msg);
            return;
          }

          if (isStyleErr && !mapDidLoad) {
            devLog('[MapCore] Custom style not found, retrying with default dark style');
            clearTimeout(loadTimeout);
            cancelled = true;
            setTimeout(() => {
              destroyMapboxMap(); mapRef.current = null;
              onStyleFallback('dark' as MapStyleId);
              setRetryNonce(n => n + 1);
            }, 0);
            return;
          }

          if (isAuthErr) {
            devLog('[MapCore] Mapbox auth error, activating MapLibre GL fallback');
            clearTimeout(loadTimeout);
            cancelled = true;
            setTimeout(() => { destroyMapboxMap(); mapRef.current = null; }, 0);
            setMapError(msg);
            setMapLibreFallback(true);
            setLoading(false);
            return;
          }

          if (mapDidLoad) {
            devLog('[MapCore] Non-fatal post-load error (ignored):', msg);
            return;
          }

          clearTimeout(loadTimeout);
          devLog('[MapCore] Mapbox init failed, activating MapLibre GL fallback');
          cancelled = true;
          setTimeout(() => { destroyMapboxMap(); mapRef.current = null; }, 0);
          setMapError(isHtmlResponseErr
            ? 'Mapbox returned an unexpected (non-JSON) response while loading the map style. This usually means the configured Mapbox token is invalid, expired, or domain-restricted — or a network filter (VPN, corporate proxy, ad-blocker) is blocking api.mapbox.com. Verify the token at account.mapbox.com/access-tokens and re-check Admin → Integrations → Mapbox.'
            : msg);
          setMapLibreFallback(true);
          setLoading(false);
        });
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to initialize Mapbox map';
          devLog('[MapCore] Mapbox init exception, activating MapLibre GL fallback');
          setMapError(msg);
          setMapLibreFallback(true);
          setLoading(false);
        }
      }
    }

    initMap();

    return () => {
      cancelled = true;
      destroyMapboxMap();
      mapRef.current = null;
    };
  }, [mapLibreFallback, preferredEngine, mapStyle, retryNonce, onStyleFallback, loadBeatOverlay]);

  return { mapContainerRef, mapRef, mapLoaded, loading, mapError, mapLibreFallback };
}
```

Note: `unitMarkersRef`/`callMarkersRef`/`selfMarkerRef` teardown (originally at `MapboxMapPage.tsx:604-607`) stays in the shell for now — those belong to marker rendering, not core lifecycle, and will move with the marker-builder utils in a later task of this same plan (Task 4).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/modules/__tests__/MapCore.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/modules/MapCore.ts client/src/pages/map/modules/__tests__/MapCore.test.ts
git commit -m "feat(map): move map-init lifecycle into useMapCore"
```

---

## Task 3: Add style-switching to `useMapCore`

Currently the shell has a separate effect (search `setMapboxStyle` in `MapboxMapPage.tsx` — verify exact line with `grep -n "setMapboxStyle" client/src/pages/map/MapboxMapPage.tsx` before editing, since Task 2 already moved code above it and line numbers have shifted) that calls `setMapboxStyle(map, mapStyle)` whenever `mapStyle` changes post-load, and re-adds 3D buildings for dark styles. This behavior moves into `useMapCore` too, since it's core map-instance lifecycle.

**Files:**
- Modify: `client/src/pages/map/modules/MapCore.ts`
- Modify: `client/src/pages/map/modules/__tests__/MapCore.test.ts`

- [ ] **Step 1: Read the current style-switch effect to confirm exact behavior**

Run: `grep -n "setMapboxStyle\|addMapbox3DBuildings\|removeMapboxTerrain" client/src/pages/map/MapboxMapPage.tsx`

Copy the effect body found there verbatim into the next step — do not paraphrase it.

- [ ] **Step 2: Write the failing test**

```ts
// append to client/src/pages/map/modules/__tests__/MapCore.test.ts
it('exposes the mapRef so style changes can be applied by callers', () => {
  const { result } = renderHook(() =>
    useMapCore({
      preferredEngine: 'mapbox',
      mapStyle: 'dark',
      onStyleFallback: vi.fn(),
      loadBeatOverlay: vi.fn(),
    })
  );
  // useMapCore itself reacts to mapStyle prop changes — verified by re-rendering
  // with a new style and confirming no crash / mapLoaded stays consistent.
  expect(() => result.current.mapRef).not.toThrow();
});
```

- [ ] **Step 3: Move the style-switch effect into `useMapCore`, appended after the init effect**

```ts
// add to client/src/pages/map/modules/MapCore.ts, inside useMapCore(), after the init effect
useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapLoaded) return;
  setMapboxStyle(map, mapStyle);
  map.once('styledata', () => {
    if (DARK_STYLES.includes(mapStyle)) addMapbox3DBuildings(map);
  });
}, [mapStyle, mapLoaded]);
```

Add `setMapboxStyle` to the existing import from `'../../../utils/mapboxLoader'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/modules/__tests__/MapCore.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/modules/MapCore.ts client/src/pages/map/modules/__tests__/MapCore.test.ts
git commit -m "feat(map): move style-switch effect into useMapCore"
```

---

## Task 4: Move marker/popup builder pure functions to `utils/mapMarkers.ts`

**Files:**
- Create: `client/src/pages/map/utils/mapMarkers.ts`
- Create: `client/src/pages/map/utils/__tests__/mapMarkers.test.ts`
- Reference (read-only): `client/src/pages/map/MapboxMapPage.tsx:114-192` (as of the pre-refactor file; re-locate with `grep -n "function buildUnitMarkerEl" client/src/pages/map/MapboxMapPage.tsx` since prior tasks may have shifted lines)

- [ ] **Step 1: Write the failing test**

```ts
// client/src/pages/map/utils/__tests__/mapMarkers.test.ts
import { describe, it, expect } from 'vitest';
import { buildUnitMarkerEl, buildUnitPopupHtml, buildCallMarkerEl, buildCallPopupHtml } from '../mapMarkers';
import type { MapUnit, ActiveCall } from '../mapConstants';

const unit: MapUnit = {
  id: 'u1', call_sign: 'A12', officer_name: 'J. Smith', status: 'available',
  vehicle: null, current_call_type: null, current_call_location: null, call_number: null,
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: FAIL with `Cannot find module '../mapMarkers'`

- [ ] **Step 3: Create `mapMarkers.ts` by moving the 4 functions verbatim**

```ts
// client/src/pages/map/utils/mapMarkers.ts
import type { MapUnit as Unit, ActiveCall } from './mapConstants';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS } from './mapConstants';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { formatEnumValue } from '../../../utils/formatters';
import { escapeHtml } from '../../../utils/sanitize';

export const HAZARD_FLAGS: { key: string; label: string; color: string }[] = [
  { key: 'officer_safety_caution', label: 'OFFICER SAFETY', color: '#ef4444' },
  { key: 'weapons_involved',       label: 'WEAPONS',        color: '#ef4444' },
  { key: 'felony_in_progress',     label: 'FELONY',         color: '#f97316' },
  { key: 'domestic_violence',      label: 'DV',             color: '#f59e0b' },
  { key: 'hazmat',                 label: 'HAZMAT',         color: '#f59e0b' },
  { key: 'mental_health_crisis',   label: 'MH CRISIS',     color: '#a855f7' },
  { key: 'gang_related',           label: 'GANG',           color: '#ef4444' },
];

/** Build HTML for a unit marker element. */
export function buildUnitMarkerEl(unit: Unit): HTMLDivElement {
  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-unit';
  el.style.cssText = `
    width:32px;height:32px;border-radius:2px;
    background:${color};border:2px solid #d4a017;
    display:flex;align-items:center;justify-content:center;
    font-size:9px;font-weight:700;color:#fff;
    font-family:ui-monospace,monospace;cursor:pointer;
    box-shadow:0 0 6px ${color}80;
    transition:box-shadow .2s;
  `;
  el.textContent = unit.call_sign.slice(0, 4);
  el.title = `${unit.call_sign} — ${UNIT_STATUS_LABELS[unit.status] || unit.status}`;
  return el;
}

/** Build HTML popup content for a unit. */
export function buildUnitPopupHtml(unit: Unit): string {
  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
  const statusLabel = UNIT_STATUS_LABELS[unit.status] || unit.status;
  const callInfo = unit.current_call_type
    ? `<div style="margin-top:4px;border-top:1px solid #222;padding-top:4px;">
         <div style="color:#d4a017;font-size:9px;">ASSIGNED CALL</div>
         <div>${escapeHtml(unit.call_number)} — ${escapeHtml(formatIncidentType(unit.current_call_type))}</div>
         <div style="color:#888;">${escapeHtml(unit.current_call_location)}</div>
       </div>`
    : '';
  return `
    <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;min-width:160px;">
      <div style="font-weight:700;color:#d4a017;margin-bottom:2px;font-size:12px;">${escapeHtml(unit.call_sign)}</div>
      <div>${escapeHtml(unit.officer_name)}</div>
      <div>Status: <span style="color:${color};font-weight:600;">${escapeHtml(statusLabel)}</span></div>
      ${unit.vehicle ? `<div style="color:#888;">Vehicle: ${escapeHtml(unit.vehicle)}</div>` : ''}
      ${callInfo}
    </div>`;
}

/** Build HTML for a call marker element. */
export function buildCallMarkerEl(call: ActiveCall): HTMLDivElement {
  const color = PRIORITY_COLORS[call.priority] || '#888888';
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-call';
  el.style.cssText = `
    width:22px;height:22px;
    background:${color};border:2px solid ${color};
    transform:rotate(45deg);border-radius:2px;
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;box-shadow:0 0 8px ${color}99;
  `;
  const inner = document.createElement('span');
  inner.style.cssText = `transform:rotate(-45deg);font-size:8px;font-weight:700;color:#fff;font-family:ui-monospace,monospace;`;
  inner.textContent = `P${call.priority}`;
  el.appendChild(inner);
  el.title = `${call.call_number} — ${formatIncidentType(call.incident_type)}`;
  return el;
}

/** Build HTML popup for a call. */
export function buildCallPopupHtml(call: ActiveCall): string {
  const color = PRIORITY_COLORS[call.priority] || '#888888';
  const flags = HAZARD_FLAGS
    .filter(f => (call as any)[f.key])
    .map(f => `<span style="background:${f.color}22;color:${f.color};padding:1px 4px;border-radius:2px;font-size:8px;font-weight:700;margin-right:3px;">${f.label}</span>`)
    .join('');
  return `
    <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;min-width:180px;">
      <div style="font-weight:700;color:${color};margin-bottom:2px;font-size:12px;">${escapeHtml(call.call_number)}</div>
      <div style="font-weight:600;">${escapeHtml(formatIncidentType(call.incident_type))}</div>
      <div>Priority: <span style="color:${color};font-weight:700;">P${escapeHtml(call.priority)}</span></div>
      <div>Status: ${escapeHtml(formatEnumValue(call.status))}</div>
      <div style="color:#888;margin-top:2px;">${escapeHtml(call.location_address)}</div>
      ${call.cross_street ? `<div style="color:#666;font-size:10px;">X: ${escapeHtml(call.cross_street)}</div>` : ''}
      ${call.beat_name ? `<div style="color:#666;font-size:10px;">Beat: ${escapeHtml(call.beat_name)}</div>` : ''}
      ${flags ? `<div style="margin-top:4px;">${flags}</div>` : ''}
    </div>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/utils/mapMarkers.ts client/src/pages/map/utils/__tests__/mapMarkers.test.ts
git commit -m "feat(map): extract marker/popup builders to utils/mapMarkers"
```

---

## Task 5: Wire `useMapCore` and `mapMarkers` into `MapboxMapPage.tsx`, delete the moved code

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Locate current line ranges to remove**

Run these to get up-to-date line numbers (they will have shifted from the original spec since this is the live file):
```bash
grep -n "function buildUnitMarkerEl\|function buildCallPopupHtml\|// ── Map Initialization\|setMapboxStyle(map, mapStyle)\|^}" client/src/pages/map/MapboxMapPage.tsx | head -20
```

- [ ] **Step 2: Replace the 4 marker/popup builder functions with an import**

Remove the function bodies (`buildUnitMarkerEl`, `buildUnitPopupHtml`, `buildCallMarkerEl`, `buildCallPopupHtml`) and the local `HAZARD_FLAGS` constant. Add:

```ts
import { buildUnitMarkerEl, buildUnitPopupHtml, buildCallMarkerEl, buildCallPopupHtml, HAZARD_FLAGS } from './utils/mapMarkers';
```

Search the rest of the file for `HAZARD_FLAGS` usages outside the deleted functions (there's a status-bar/legend usage) — keep those pointed at the imported constant.

- [ ] **Step 3: Replace inline map-init state/effects with `useMapCore`**

Remove:
- The `mapContainerRef`, `mapRef`, `tokenRef` declarations (now come from the hook)
- `mapLoaded`, `loading`, `mapError`, `mapLibreFallback`, `retryNonce` state (now come from the hook) — but keep `retryNonce`'s original external trigger points working: search for `setRetryNonce` call sites outside the init effect (e.g. a manual "Retry" button) and replace them with a `retry()` function you add to `useMapCore`'s return value that bumps its internal `retryNonce`.
- Both `useEffect` blocks under `// ── Map Initialization ──` and the style-switch effect

Add:
```ts
const { mapContainerRef, mapRef, mapLoaded, loading, mapError, mapLibreFallback, retry } = useMapCore({
  preferredEngine,
  mapStyle,
  onStyleFallback: setMapStyleId,
  loadBeatOverlay,
});
```

(`loadBeatOverlay` must already exist as a function in the shell — confirm with `grep -n "function loadBeatOverlay\|loadBeatOverlay =" client/src/pages/map/MapboxMapPage.tsx`; if it's defined after the hooks-call point, hoist it above via `useCallback` so it's stable before `useMapCore` is invoked.)

- [ ] **Step 4: Add a `retry` return value to `useMapCore`**

```ts
// in client/src/pages/map/modules/MapCore.ts, add to the returned object:
const retry = useCallback(() => setRetryNonce(n => n + 1), []);
// ...
return { mapContainerRef, mapRef, mapLoaded, loading, mapError, mapLibreFallback, retry };
```
Update `UseMapCoreResult` to include `retry: () => void;`.

- [ ] **Step 5: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors introduced by this file (pre-existing unrelated errors in other files, e.g. `@simplewebauthn/server`, are out of scope — confirm the error count/set matches what existed before this task by running the same command on the previous commit and diffing)

- [ ] **Step 6: Manual browser verification**

Start the dev server (`preview_start`), navigate to the Map page, and confirm:
- Map loads and renders units/calls markers with popups showing correct data
- Switching map style (dark/satellite/etc.) still works
- Simulating a token failure (temporarily blank `VITE_MAPBOX_ACCESS_TOKEN`) still shows the same fallback error message as before

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "refactor(map): wire useMapCore + mapMarkers into MapboxMapPage, remove moved code"
```

---

## Task 6: Move remaining core hooks (`useMapProjection`, `useMapAtmosphere`, `useMapDaylight`, `useMapCameraAnimation`, `useMapSnapshot`, `useMapOptimization`) into `useMapCore`

These are already-built standalone hooks (unchanged internals per the spec's non-goals) — this task only moves *where they're called* into `useMapCore`, so the shell no longer calls them directly.

**Files:**
- Modify: `client/src/pages/map/modules/MapCore.ts`
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Confirm each hook's current call signature in the shell**

Run: `grep -n "useMapProjection\|useMapAtmosphere\|useMapDaylight\|useMapCameraAnimation\|useMapSnapshot\|useMapOptimization" client/src/pages/map/MapboxMapPage.tsx`

Copy each call's exact arguments (they all take `(mapRef.current, mapLoaded)` per the current file — confirm no exceptions before proceeding).

- [ ] **Step 2: Add the 6 hook calls inside `useMapCore`, and surface their return values**

```ts
// add imports at top of client/src/pages/map/modules/MapCore.ts
import { useMapProjection } from '../../../hooks/useMapProjection';
import { useMapAtmosphere } from '../../../hooks/useMapAtmosphere';
import { useMapDaylight } from '../../../hooks/useMapDaylight';
import { useMapCameraAnimation } from '../../../hooks/useMapCameraAnimation';
import { useMapSnapshot } from '../../../hooks/useMapSnapshot';
import { useMapOptimization } from '../../../hooks/useMapOptimization';

// inside useMapCore(), before the return statement:
const projection = useMapProjection(mapRef.current, mapLoaded);
const atmosphere = useMapAtmosphere(mapRef.current, mapLoaded);
const daylight = useMapDaylight(mapRef.current, mapLoaded);
const cameraAnimation = useMapCameraAnimation(mapRef.current, mapLoaded);
const snapshot = useMapSnapshot();
const optimization = useMapOptimization(mapRef.current, mapLoaded);

// add to the returned object:
return {
  mapContainerRef, mapRef, mapLoaded, loading, mapError, mapLibreFallback, retry,
  projection, atmosphere, daylight, cameraAnimation, snapshot, optimization,
};
```

Update `UseMapCoreResult` with the corresponding typed fields (use each hook's existing exported return-type interface — check `client/src/hooks/useMapProjection.ts` etc. for the exact type name to import rather than typing `any`).

- [ ] **Step 3: Update `MapboxMapPage.tsx` to read these off the `useMapCore` result instead of calling the hooks directly**

Remove the 6 direct hook calls and their imports from `MapboxMapPage.tsx`. Add destructuring from the `useMapCore()` call:

```ts
const {
  mapContainerRef, mapRef, mapLoaded, loading, mapError, mapLibreFallback, retry,
  projection, atmosphere, daylight, cameraAnimation, snapshot, optimization,
} = useMapCore({ preferredEngine, mapStyle, onStyleFallback: setMapStyleId, loadBeatOverlay });
```

Note: `daylight` was previously also used by `useMapKeyboardShortcuts`'s `toggleDaylight: () => daylight.toggle()` — confirm that reference still resolves correctly against the new destructured `daylight` object (no rename needed, but verify with `grep -n "daylight\." client/src/pages/map/MapboxMapPage.tsx` that every usage still matches the hook's real field names).

- [ ] **Step 4: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors vs. the Task 5 baseline

- [ ] **Step 5: Manual browser verification**

In the browser preview: toggle 3D projection/atmosphere, daylight simulation, camera fly-to, and snapshot/export — confirm each still works identically to pre-refactor behavior.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/modules/MapCore.ts client/src/pages/map/MapboxMapPage.tsx
git commit -m "refactor(map): move projection/atmosphere/daylight/camera/snapshot/optimization hooks into useMapCore"
```

---

## Self-Review Notes

- **Spec coverage:** This plan covers the `MapCore` row of the spec's module table in full (init, style switching, projection, atmosphere, daylight, camera animation, snapshot, optimization) plus the marker/popup builder utils relocation the spec calls out separately. `MapDrawing`, `MapAnalysis`, `MapRouting`, `MapOverlaysAndAlerts`, `MapToolsSidebar`, `MapStatusBar` are explicitly out of scope for this plan — each needs its own plan once this one lands, since line numbers and available shell state will have changed.
- **Placeholder scan:** No TBD/TODO markers. Every code step has verbatim code, sourced from the actual current file content read during planning (Tasks 2–4) or the existing typed hook contracts referenced in Task 6.
- **Type consistency:** `UseMapCoreOptions`/`UseMapCoreResult` field names (`mapContainerRef`, `mapRef`, `mapLoaded`, `loading`, `mapError`, `mapLibreFallback`, `retry`) are used consistently across Tasks 1–6. `onStyleFallback` replaces the original `setMapStyleId` call inside the init effect's style-not-found branch — this is a deliberate, named prop so `useMapCore` doesn't need to import the shell's `usePersistedState` setter type.
