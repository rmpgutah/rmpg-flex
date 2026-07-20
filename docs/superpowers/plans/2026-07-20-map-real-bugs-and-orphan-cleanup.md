# Map Tab — Real Bugs & Orphaned Feature Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 real bugs in the Map tab's existing functionality and resolve 12 orphaned/dead-code findings (wire in 4 components + 1 hook, delete 6 confirmed-dead files) — the two remaining categories from an earlier Map tab audit.

**Architecture:** Every change is a targeted fix inside `client/src/pages/map/` or a directly-related hook in `client/src/hooks/` — no new architecture, no new dependencies. Wiring tasks mount an already-fully-built component/hook using data `MapboxMapPage.tsx` already has in scope; deletion tasks remove a file (and its now-dangling call sites) confirmed to have zero live consumers.

**Tech Stack:** React 18 + TypeScript + Vite, Mapbox GL JS v3, Tailwind CSS.

## Global Constraints

- Every JSX element uses `style={{ borderRadius: 2 }}` for corners, never a `rounded`/`rounded-md` Tailwind class (project-wide rule; the app's global CSS override only catches `rounded-md/lg/xl/2xl/3xl`, not bare `rounded`).
- Never hardcode hex colors in new React JSX — use the app's `brand-gold-500`/`surface-raised`/`border-default`/`rmpg-*` Tailwind tokens. Raw hex strings inside Mapbox paint-property objects and inline-HTML-string popups (a pre-existing pattern throughout this codebase) are fine and expected — that's how every existing marker/popup in this file already works.
- `client/src/pages/map/MapboxMapPage.tsx` is the ~1650-line single page every dock section, toggle, and floating panel is orchestrated from. Read the surrounding ~20 lines before editing any snippet below — line numbers are as of this plan's writing and will drift slightly as earlier tasks in this plan land.
- After every task: `cd client && npx tsc --noEmit` must stay clean, and `npx vitest run` must show no new failures (baseline: 423 files / 2877 tests passing, confirmed by this plan's author before writing).
- Non-goals (do NOT touch): `MapboxDispatchConnections` stays orphaned; the ~26 other panels/hooks tracked in `client/src/pages/map/_ORPHANS.md` beyond what Task 19 touches stay untouched.

---

### Task 1: Fix MinimapControl overlapping the Right Dock (A1)

**Files:**
- Modify: `client/src/pages/map/components/MinimapControl.tsx:38-41`

**Interfaces:** None — self-contained CSS positioning fix, no prop/type changes.

- [ ] **Step 1: Change `fixed` to `absolute`**

The minimap is mounted inside `MapboxMapPage.tsx`'s map-canvas wrapper
(`<div className="relative flex-1">`, opened at `MapboxMapPage.tsx:1297`), which
IS `position: relative` — so switching to `absolute` correctly confines the
minimap to that canvas area instead of the true viewport, where it currently
overlaps `MapRightDock` (a flex sibling of the canvas div, not a descendant).

Find in `client/src/pages/map/components/MinimapControl.tsx`:
```tsx
    <div
      className="fixed bottom-4 right-4 z-40 tactical-dark border border-surface-raised rounded shadow-lg overflow-hidden"
      style={{ width: 180, height: 140 }}
    >
```
Replace with:
```tsx
    <div
      className="absolute bottom-4 right-4 z-40 tactical-dark border border-surface-raised shadow-lg overflow-hidden"
      style={{ width: 180, height: 140, borderRadius: 2 }}
    >
```
(Also fixes the plain `rounded` class per the Global Constraints border-radius rule
while touching this line — swapped for the `style` `borderRadius: 2`.)

- [ ] **Step 2: Manual verification**

This is a pure CSS positioning change with no existing test coverage (grep confirms
no `MinimapControl.test.*` file exists). Run `cd client && npx tsc --noEmit` to
confirm no type errors, then visually confirm in a browser (if a Mapbox token is
available in this environment) that opening the minimap while the Right Dock is
visible no longer overlaps the dock's content — the minimap should sit in the
bottom-right corner of the map canvas, to the LEFT of the dock, not on top of it.
If no live Mapbox token is available to verify visually in this environment, note
that in the task report as a known gap (matches this repo's established pattern
for Map-tab work when a token isn't configured locally).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/map/components/MinimapControl.tsx
git commit -m "fix(map): MinimapControl no longer overlaps the Right Dock

Switched from position:fixed (escapes to the true viewport) to
position:absolute (confined to its relative map-canvas ancestor),
so it no longer renders on top of MapRightDock's bottom-right corner."
```

---

### Task 2: Delete the dead "Beat Boundaries" toggle (A2)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx` (multiple sites, listed below)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this task only removes dead code. `geo-beat` ("Beats",
  from `useGeoJsonLayers`) remains the sole beat-boundary toggle; no other task in
  this plan depends on the removed `beatsVisible`/`loadBeatOverlay` identifiers.

`client/public/beats.geojson` does not exist — `loadBeatOverlay`'s fetch 404s,
hits `if (!resp.ok) { devWarn(...); return; }`, and silently no-ops. Every piece of
code below exists only to serve that dead toggle.

- [ ] **Step 1: Remove the `beatsVisible` state**

Find in `client/src/pages/map/MapboxMapPage.tsx`:
```tsx
  const [beatsVisible, setBeatsVisible] = usePersistedState('rmpg_mapbox_beats', true);
```
Delete this line entirely.

- [ ] **Step 2: Remove the `loadBeatOverlay` callback**

Find and delete the entire block (including its preceding comment) in
`client/src/pages/map/MapboxMapPage.tsx`:
```tsx
  // ── Beat GeoJSON Overlay ───────────────────────────────────────────────────
  // Defined before useMapCore() below because it's passed in as loadBeatOverlay
  // and must be a stable (useCallback) reference — see MapCore.ts's JSDoc.

  const loadBeatOverlay = useCallback(async (map: mapboxgl.Map) => {
    try {
      const resp = await fetch('/beats.geojson');
      if (!resp.ok) { devWarn('[MapboxMap] beats.geojson not found'); return; }
      const geojson = await resp.json();

      // Remove existing beat layers/source if present (e.g. after style change)
      ['beats-label', 'beats-border', 'beats-fill'].forEach(id => {
        safeRemoveLayer(map, id);
      });
      safeRemoveSource(map, 'beats');

      upsertGeoJsonSource(map, 'beats', geojson);

      map.addLayer({
        id: 'beats-fill',
        type: 'fill',
        source: 'beats',
        paint: {
          'fill-color': '#d4a017',
          'fill-opacity': 0.04,
        },
      });

      map.addLayer({
        id: 'beats-border',
        type: 'line',
        source: 'beats',
        paint: {
          'line-color': '#d4a017',
          'line-opacity': 0.35,
          'line-width': 1,
        },
      });

      map.addLayer({
        id: 'beats-label',
        type: 'symbol',
        source: 'beats',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#d4a017',
          'text-opacity': 0.5,
          'text-halo-color': '#000',
          'text-halo-width': 1,
        },
        minzoom: 13,
      });

      devLog('[MapboxMap] beat overlay added');
    } catch (err) {
      devWarn('[MapboxMap] beat overlay failed', err);
    }
  }, []);
```

- [ ] **Step 3: Remove `loadBeatOverlay` from the `useMapCore()` call**

Find:
```tsx
  } = useMapCore({
    preferredEngine,
    mapStyle,
    retryNonce,
    onStyleFallback,
    onRetryNonceRequest,
    loadBeatOverlay,
    terrainEnabled,
  });
```
Replace with:
```tsx
  } = useMapCore({
    preferredEngine,
    mapStyle,
    retryNonce,
    onStyleFallback,
    onRetryNonceRequest,
    terrainEnabled,
  });
```

- [ ] **Step 4: Remove `loadBeatOverlay` from `MapCore.ts`'s interface and both call sites**

`loadBeatOverlay` is a **required** param of `useMapCore` — Step 3 alone leaves a
type error until this step also removes it from `client/src/pages/map/modules/MapCore.ts`.

Find in `client/src/pages/map/modules/MapCore.ts`:
```ts
export interface UseMapCoreOptions {
  preferredEngine: 'mapbox' | 'maplibre';
  mapStyle: MapStyleId;
  retryNonce: number;
  /**
   * `onStyleFallback`, `onRetryNonceRequest`, and `loadBeatOverlay` must be stable
   * references across renders (e.g. wrapped in `useCallback`) — the internal init
   * effect closes over them without listing them as dependencies, so a new inline
   * function on every render will be captured as a stale closure.
   */
  /** Called to switch the persisted map style (used on style-not-found retry). */
  onStyleFallback: (style: MapStyleId) => void;
  /** Called to bump the caller-owned retryNonce (used on style-not-found retry). */
  onRetryNonceRequest: () => void;
  loadBeatOverlay: (map: mapboxgl.Map) => void | Promise<void>;
  /** Whether 3D terrain is currently enabled — replicated onto the map after a style switch. */
  terrainEnabled: boolean;
}
```
Replace with:
```ts
export interface UseMapCoreOptions {
  preferredEngine: 'mapbox' | 'maplibre';
  mapStyle: MapStyleId;
  retryNonce: number;
  /**
   * `onStyleFallback` and `onRetryNonceRequest` must be stable references across
   * renders (e.g. wrapped in `useCallback`) — the internal init effect closes over
   * them without listing them as dependencies, so a new inline function on every
   * render will be captured as a stale closure.
   */
  /** Called to switch the persisted map style (used on style-not-found retry). */
  onStyleFallback: (style: MapStyleId) => void;
  /** Called to bump the caller-owned retryNonce (used on style-not-found retry). */
  onRetryNonceRequest: () => void;
  /** Whether 3D terrain is currently enabled — replicated onto the map after a style switch. */
  terrainEnabled: boolean;
}
```

Find:
```ts
export function useMapCore({
  preferredEngine, mapStyle, retryNonce, onStyleFallback, onRetryNonceRequest, loadBeatOverlay,
  terrainEnabled,
}: UseMapCoreOptions): UseMapCoreResult {
```
Replace with:
```ts
export function useMapCore({
  preferredEngine, mapStyle, retryNonce, onStyleFallback, onRetryNonceRequest,
  terrainEnabled,
}: UseMapCoreOptions): UseMapCoreResult {
```

Find (inside the `map.on('load', ...)` handler):
```ts
          if (DARK_STYLES.includes(mapStyle)) addMapbox3DBuildings(map);
          loadBeatOverlay(map);
          setMapLoaded(true);
```
Replace with:
```ts
          if (DARK_STYLES.includes(mapStyle)) addMapbox3DBuildings(map);
          setMapLoaded(true);
```

Find (inside `changeStyle`):
```ts
  const changeStyle = useCallback((styleId: MapStyleId) => {
    const map = mapRef.current;
    if (!map) return;
    activeStyleRef.current = styleId;
    setMapboxStyle(map, styleId);
    map.once('style.load', () => {
      if (DARK_STYLES.includes(styleId)) addMapbox3DBuildings(map);
      loadBeatOverlay(map);
      if (terrainEnabled) addMapboxTerrain(map);
    });
  }, [loadBeatOverlay, terrainEnabled]);
```
Replace with:
```ts
  const changeStyle = useCallback((styleId: MapStyleId) => {
    const map = mapRef.current;
    if (!map) return;
    activeStyleRef.current = styleId;
    setMapboxStyle(map, styleId);
    map.once('style.load', () => {
      if (DARK_STYLES.includes(styleId)) addMapbox3DBuildings(map);
      if (terrainEnabled) addMapboxTerrain(map);
    });
  }, [terrainEnabled]);
```
Also update the JSDoc comment above `changeStyle` in the `UseMapCoreResult`
interface — find:
```ts
  /**
   * Switches the live map instance to a new style and re-applies dark-style 3D
   * buildings, the beat overlay, and terrain (if enabled) once the new style loads.
   * Callers must also update their own persisted `mapStyle` state after calling
   * this (e.g. `setMapStyleId(styleId)`) — `changeStyle` only mutates the live map
   * instance, it does not update the `mapStyle` option this hook was called with.
   */
```
Replace with:
```ts
  /**
   * Switches the live map instance to a new style and re-applies dark-style 3D
   * buildings and terrain (if enabled) once the new style loads. Callers must
   * also update their own persisted `mapStyle` state after calling this (e.g.
   * `setMapStyleId(styleId)`) — `changeStyle` only mutates the live map instance,
   * it does not update the `mapStyle` option this hook was called with.
   */
```

- [ ] **Step 5: Remove the beat-visibility effect**

Find in `client/src/pages/map/MapboxMapPage.tsx`:
```tsx
  // Toggle beat visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const vis = beatsVisible ? 'visible' : 'none';
    ['beats-fill', 'beats-border', 'beats-label'].forEach(id => {
      if (hasLayer(map, id)) map.setLayoutProperty(id, 'visibility', vis);
    });
  }, [beatsVisible, mapLoaded]);
```
Delete this entire block.

- [ ] **Step 6: Remove the `beats` dock-array entry and dependency-array references**

Find in `mapLeftDockSections`:
```tsx
        { id: 'beats', label: 'Beat Boundaries', active: beatsVisible, onToggle: () => setBeatsVisible((v: boolean) => !v), color: '#d4a017' },
```
Delete this line.

In that same `useMemo`'s dependency array, remove `beatsVisible` and
`setBeatsVisible` (find-and-replace exact substrings `beatsVisible, ` and
`setBeatsVisible, ` — check the array carefully, since other dependencies share
similar prefixes like `beatsVisible`/`buildings3dEnabled`; only remove the two
exact identifiers named here).

- [ ] **Step 7: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. In particular confirm no remaining reference to
`beatsVisible`, `setBeatsVisible`, or `loadBeatOverlay` anywhere:
```bash
grep -rn "beatsVisible\|setBeatsVisible\|loadBeatOverlay" client/src/pages/map/
```
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx client/src/pages/map/modules/MapCore.ts
git commit -m "fix(map): delete the dead \"Beat Boundaries\" toggle

client/public/beats.geojson doesn't exist -- loadBeatOverlay's fetch
404s and silently no-ops every time. The working beat-boundary layer
is the separately-sourced 'geo-beat' (\"Beats\") toggle from
useGeoJsonLayers, which stays as the sole survivor."
```

---

### Task 3: Fix the dead `(G)` coordinate-grid keyboard shortcut (A3)

**Files:**
- Modify: `client/src/hooks/useMapKeyboardShortcuts.ts:68-80, 96-105`
- Test: `client/src/hooks/__tests__/useMapKeyboardShortcuts.test.ts` (create if it doesn't exist, or extend if it does — check first)

**Interfaces:** None — `toggleGrid` is already part of `MapShortcutHandlers` and
already passed by `MapboxMapPage.tsx:602` (`toggleGrid: () => coordGrid.toggle()`);
this task only fixes the hook's internal dispatch.

- [ ] **Step 1: Check for an existing test file**

Run: `ls client/src/hooks/__tests__/useMapKeyboardShortcuts.test.ts 2>&1`

- [ ] **Step 2: Write the failing test**

If the file exists, add this test case to it; if not, create it with this content
(adjust the import path if the existing file uses a different relative path style):
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapKeyboardShortcuts } from '../useMapKeyboardShortcuts';

describe('useMapKeyboardShortcuts — G coordinate grid', () => {
  afterEach(() => {
    // Clean up any listeners a failed prior run left attached.
    vi.restoreAllMocks();
  });

  it('calls toggleGrid when G is pressed', () => {
    const toggleGrid = vi.fn();
    renderHook(() => useMapKeyboardShortcuts({ toggleGrid }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));

    expect(toggleGrid).toHaveBeenCalledTimes(1);
  });

  it('is case-insensitive (Shift+G)', () => {
    const toggleGrid = vi.fn();
    renderHook(() => useMapKeyboardShortcuts({ toggleGrid }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'G' }));

    expect(toggleGrid).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapKeyboardShortcuts.test.ts`
Expected: FAIL — `toggleGrid` was never called (no `case 'g'` exists yet).

- [ ] **Step 4: Add the `g` case to the switch**

Find in `client/src/hooks/useMapKeyboardShortcuts.ts`:
```ts
        switch (key) {
          case 'h': return handlers.toggleHeatmap;
          case 'b': return handlers.toggleBreadcrumbs;
          case 'c': return handlers.toggleClustering;
          case 'p': return handlers.togglePatrolCheckpoints;
          case 'f': return handlers.toggleFieldInterviews;
          case 'd': return handlers.toggleDaylight;
          case 'i': return handlers.toggleIncidentReports;
          case 'e': return handlers.toggleEnforcementClusters;
          case '?': return showHelp;
          default: return null;
        }
```
Replace with:
```ts
        switch (key) {
          case 'h': return handlers.toggleHeatmap;
          case 'b': return handlers.toggleBreadcrumbs;
          case 'c': return handlers.toggleClustering;
          case 'p': return handlers.togglePatrolCheckpoints;
          case 'f': return handlers.toggleFieldInterviews;
          case 'd': return handlers.toggleDaylight;
          case 'i': return handlers.toggleIncidentReports;
          case 'e': return handlers.toggleEnforcementClusters;
          case 'g': return handlers.toggleGrid;
          case '?': return showHelp;
          default: return null;
        }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapKeyboardShortcuts.test.ts`
Expected: PASS (both new tests).

- [ ] **Step 6: Correct `MAP_SHORTCUT_BINDINGS`'s stale comment and add the G entry**

`MAP_SHORTCUT_BINDINGS` is exported but has zero importers anywhere in the app
(verified via `grep -rn "MAP_SHORTCUT_BINDINGS" client/src` — only its own
declaration matches) — there is currently no help overlay that reads this
constant, so this step is documentation-only (keeps the exported list accurate
for whenever a help overlay is eventually built), not a user-visible fix on its
own. Find:
```ts
/** Pretty list of the shortcut bindings — for the help overlay.
 *  KEEP IN SYNC with the inline keydown handler in MapPage.tsx — the modal
 *  reads from this constant and operators trust the list to match what
 *  actually happens. (Previous drift: this listed P/F/D/I/E for never-wired
 *  Phase-2 overlays; the inline handler actually binds L/H/B/C/+/-/Esc.) */
export const MAP_SHORTCUT_BINDINGS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'L', label: 'Toggle layers panel' },
  { key: 'H', label: 'Toggle heatmap' },
  { key: 'B', label: 'Toggle breadcrumb trails' },
  { key: 'C', label: 'Center on all units' },
  { key: '+ / =', label: 'Zoom in' },
  { key: '−', label: 'Zoom out' },
  { key: 'Esc', label: 'Close all panels' },
  { key: '?', label: 'Show this help' },
];
```
Replace with:
```ts
/** Pretty list of this hook's own shortcut bindings. NOT currently read by any
 *  help overlay (grep confirms zero importers of this constant) — it previously
 *  described a DIFFERENT legacy keydown handler's bindings (L/+/-/Esc, none of
 *  which this hook's switch above actually implements), which was itself
 *  inaccurate. Kept accurate to THIS hook's real switch statement so a future
 *  help overlay can safely read from it. */
export const MAP_SHORTCUT_BINDINGS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'H', label: 'Toggle heatmap' },
  { key: 'B', label: 'Toggle breadcrumb trails' },
  { key: 'C', label: 'Toggle call clustering' },
  { key: 'P', label: 'Toggle patrol checkpoints' },
  { key: 'F', label: 'Toggle field interviews' },
  { key: 'D', label: 'Toggle daylight overlay' },
  { key: 'I', label: 'Toggle incident reports' },
  { key: 'E', label: 'Toggle enforcement clusters' },
  { key: 'G', label: 'Toggle coordinate grid' },
  { key: '?', label: 'Show this help' },
];
```

- [ ] **Step 7: Full test run**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapKeyboardShortcuts.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/hooks/useMapKeyboardShortcuts.ts client/src/hooks/__tests__/useMapKeyboardShortcuts.test.ts
git commit -m "fix(map): wire the dead (G) coordinate-grid keyboard shortcut

toggleGrid was threaded all the way into the hook's handlers prop but
the internal switch had no 'g' case, so pressing G silently did
nothing. Also corrected MAP_SHORTCUT_BINDINGS, which described an
unrelated legacy handler's (also-inaccurate) bindings rather than
this hook's real switch -- it has zero importers today, so this is
documentation-only until a help overlay reads it."
```

---

### Task 4: Fix MultiStopRoutePanel's responsive breakpoint mismatch (A4)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx:1532`

**Interfaces:** None — `MultiStopRoutePanel`'s `isMobile: boolean` prop type is
unchanged; only which boolean is passed changes.

- [ ] **Step 1: Pass `isDockNarrow` instead of `isMobile`**

The dock system's own narrow/wide threshold is `isDockNarrow = useIsMobile(1024)`
(`MapboxMapPage.tsx:335`) — below 1024px the top toolbar and side docks collapse
into `MapBottomTray`. `MultiStopRoutePanel` currently receives `isMobile` (the
separate 768px-threshold flag), so in the 768-1024px band it still renders in
"desktop" layout at a toolbar-anchored position even though the toolbar itself has
already collapsed away.

Find in `client/src/pages/map/MapboxMapPage.tsx`:
```tsx
          <MultiStopRoutePanel
            queue={multiStopQueue}
            units={units}
            selectedUnit={multiStopUnit}
            result={routing.multiStopRoute}
            loading={routing.multiStopLoading}
            isMobile={isMobile}
```
Replace with:
```tsx
          <MultiStopRoutePanel
            queue={multiStopQueue}
            units={units}
            selectedUnit={multiStopUnit}
            result={routing.multiStopRoute}
            loading={routing.multiStopLoading}
            isMobile={isDockNarrow}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors — `MultiStopRoutePanel`'s `isMobile` prop type (`boolean`) is
satisfied by `isDockNarrow` (also `boolean`) unchanged.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "fix(map): MultiStopRoutePanel now uses the dock system's own breakpoint

It received the 768px isMobile flag while the rest of the page
collapses to narrow layout at 1024px (isDockNarrow) -- in the
768-1024px band the panel rendered in \"desktop\" mode with no
toolbar above it to anchor against."
```

---

### Task 5: Fix the "Bookmarks" naming collision + build the bookmarks list panel (A5)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx` (dock array entry + new list panel JSX)

**Interfaces:**
- Consumes: `mapBookmarks` (already `useMapBookmarks(mapRef.current, mapLoaded)` at
  `MapboxMapPage.tsx:565`) — specifically `mapBookmarks.bookmarks: MapBookmark[]`,
  `mapBookmarks.flyToBookmark(id: string): void`,
  `mapBookmarks.removeBookmark(id: string): void`. `MapBookmark` shape (from
  `client/src/hooks/useMapBookmarks.ts`):
  ```ts
  export interface MapBookmark {
    id: string; name: string; latitude: number; longitude: number;
    color: string; notes: string; createdAt: number; zoom: number;
  }
  ```
- Produces: nothing new for later tasks.

- [ ] **Step 1: Rename the dock toggle**

Find in `mapRightDockSections`' "Dispatch Tools" section:
```tsx
        { id: 'bookmarks', label: 'Bookmarks', active: mapBookmarks.bookmarks.length > 0, onToggle: () => mapBookmarks.dropMode ? mapBookmarks.setDropMode(false) : mapBookmarks.setDropMode(true), color: '#eab308', description: 'Save map locations' },
```
Replace with:
```tsx
        { id: 'bookmarks', label: 'Drop Bookmark', active: mapBookmarks.dropMode, onToggle: () => mapBookmarks.dropMode ? mapBookmarks.setDropMode(false) : mapBookmarks.setDropMode(true), color: '#eab308', description: 'Click the map to save a location' },
```
(Also fixed `active` to reflect whether drop-mode itself is on, not whether any
bookmark happens to exist — the old condition made the toggle look "active"
forever once a single bookmark was ever saved, even with drop-mode off.)

- [ ] **Step 2: Render a bookmarks-list panel gated on `showBookmarksPanel`**

Find the deep-link popup / minimap mount area in `MapboxMapPage.tsx` (near
`{minimapOpen && mapRef.current && (<MinimapControl .../>)}`) and add a new block
immediately after it:
```tsx
      {showBookmarksPanel && (
        <div
          className="absolute top-11 right-3 z-30 bg-surface-raised/95 border border-border-default backdrop-blur-sm font-mono overflow-hidden"
          style={{ borderRadius: 2, width: 260, maxHeight: 320, boxShadow: '0 8px 28px rgba(0,0,0,0.55)' }}
        >
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border-subtle">
            <Star className="w-3.5 h-3.5 text-brand-gold-500" />
            <span className="text-[10px] font-black tracking-wider text-brand-gold-500 flex-1 uppercase">
              Bookmarks
            </span>
            <span className="text-[8px] font-black text-surface-base bg-brand-gold-500 px-1.5 py-px" style={{ borderRadius: 2 }}>
              {mapBookmarks.bookmarks.length}
            </span>
          </div>
          <div className="scrollbar-dark overflow-y-auto" style={{ maxHeight: 260 }}>
            {mapBookmarks.bookmarks.length === 0 ? (
              <div className="px-2.5 py-3 text-[10px] text-rmpg-500">
                No bookmarks yet — use "Drop Bookmark" to save a location.
              </div>
            ) : (
              mapBookmarks.bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border-subtle cursor-pointer hover:bg-surface-overlay"
                  onClick={() => mapBookmarks.flyToBookmark(bm.id)}
                >
                  <span
                    className="w-2 h-2 shrink-0"
                    style={{ borderRadius: '50%', background: bm.color, boxShadow: `0 0 4px ${bm.color}80` }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold text-rmpg-200 truncate">{bm.name}</div>
                    <div className="text-[8px] text-rmpg-500">{new Date(bm.createdAt).toLocaleDateString()}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); mapBookmarks.removeBookmark(bm.id); }}
                    aria-label={`Remove bookmark ${bm.name}`}
                    className="text-rmpg-500 hover:text-red-400 shrink-0 p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
```
Check the top of `MapboxMapPage.tsx`'s `lucide-react` import for `Star` and `X` —
both are almost certainly already imported (used elsewhere in this same file for
other panels/buttons); if either is missing from the existing
`import { ... } from 'lucide-react';` line, add it there rather than a second
import statement.

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

If a live Mapbox token is available: click the toolbar's bookmarks (star) button —
the new panel should appear top-right showing "No bookmarks yet…"; use "Drop
Bookmark" from the right dock, click the map, confirm the new bookmark appears in
the list and clicking it flies the map there; confirm the trash icon removes it.
If no token is available in this environment, note that as a known gap in the task
report (matches this repo's established pattern).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "fix(map): resolve the \"Bookmarks\" naming collision + build its list panel

Renamed the dock toggle (pin-drop mode) to \"Drop Bookmark\" so it no
longer shares a name with the toolbar's \"Bookmarks\" button, which was
previously fully dead (its state was set and never read). Built a
real bookmarks-list panel for that button using mapBookmarks' already
-built data/fly-to/remove methods."
```

---

### Task 6: Fix SpeedGraphOverlay's silent empty state (A6)

**Files:**
- Modify: `client/src/pages/map/components/SpeedGraphOverlay.tsx`
- Test: `client/src/pages/map/components/__tests__/SpeedGraphOverlay.test.tsx` (check if it exists first)

**Interfaces:** None — `SpeedGraphOverlayProps` (`unitId`, `callSign`, `hours`,
`onClose`) is unchanged.

- [ ] **Step 1: Check for an existing test file and read it if present**

Run: `ls client/src/pages/map/components/__tests__/SpeedGraphOverlay.test.tsx 2>&1`

If it exists, read it fully before writing Step 2's test so the new test matches
its existing render/mocking conventions (e.g. how `apiFetch` is mocked).

- [ ] **Step 2: Write the failing test**

Add this test (create the file with a minimal `apiFetch` mock returning an empty
trail if no test file exists yet; if one exists, follow its established mocking
pattern for `apiFetch` instead of this literal `vi.mock`):
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SpeedGraphOverlay from '../SpeedGraphOverlay';

vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ unit_id: 1, points: [] }),
}));

describe('SpeedGraphOverlay — empty state', () => {
  it('shows a "no data" message instead of rendering nothing when there are fewer than 2 points', async () => {
    render(<SpeedGraphOverlay unitId={1} callSign="A12" hours={4} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/no speed data/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/SpeedGraphOverlay.test.tsx`
Expected: FAIL — component currently renders `null` (nothing to query for).

- [ ] **Step 4: Replace the silent `return null` with a "no data" card**

Find in `client/src/pages/map/components/SpeedGraphOverlay.tsx`:
```tsx
  if (points.length < 2) return null;
```
Replace with:
```tsx
  if (points.length < 2) {
    return (
      <div className="absolute bottom-14 right-2 z-40 w-[260px] bg-surface-raised/95 border border-rmpg-700 font-mono text-[11px] text-rmpg-200 select-none" style={{ borderRadius: 2 }}>
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-rmpg-700">
          <div className="flex items-center gap-1.5">
            <Gauge size={14} className="text-brand-gold-400" />
            <span className="text-brand-gold-400 font-semibold text-[11px]">{callSign}</span>
          </div>
          <button onClick={onClose} className="p-0.5 flex items-center" aria-label="Close speed graph">
            <X size={14} className="text-rmpg-500" />
          </button>
        </div>
        <div className="px-2.5 py-3 text-[10px] text-rmpg-500">
          No speed data for this unit in the last {hours}h.
        </div>
      </div>
    );
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/SpeedGraphOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/components/SpeedGraphOverlay.tsx client/src/pages/map/components/__tests__/SpeedGraphOverlay.test.tsx
git commit -m "fix(map): SpeedGraphOverlay shows a message instead of nothing when a unit has too little trail data

Clicking a Speed Violations marker for a unit with <2 recent GPS
points previously produced zero visible feedback that the click
registered."
```

---

### Task 7: Delete 3 confirmed-dead files with zero references anywhere (useClosestUnit, useMapboxInit, mapboxOverlays)

**Files:**
- Delete: `client/src/pages/map/hooks/useClosestUnit.ts`
- Delete: `client/src/pages/map/hooks/useMapboxInit.ts`
- Delete: `client/src/pages/map/utils/mapboxOverlays.ts`

**Interfaces:** None. Verified (via `grep -rln` for each filename/export symbol
across `client/src`, including test files) that all three have zero importers
anywhere — this task is pure deletion, no other file references anything in them.

- [ ] **Step 1: Re-verify zero references immediately before deleting (defensive check)**

```bash
grep -rln "useClosestUnit" client/src --include="*.ts" --include="*.tsx" | grep -v "pages/map/hooks/useClosestUnit.ts"
grep -rln "useMapboxInit" client/src --include="*.ts" --include="*.tsx" | grep -v "pages/map/hooks/useMapboxInit.ts"
grep -rln "mapboxOverlays\|MapboxOverlayManager\|circleGeoJSON\|makePopup\|makeMarker" client/src --include="*.ts" --include="*.tsx" | grep -v "pages/map/utils/mapboxOverlays.ts"
```
Expected: no output from any of the three commands (confirming no live or test
file imports any of them). If any command DOES produce output, stop and report
BLOCKED — the file is not actually dead and this task needs re-scoping.

- [ ] **Step 2: Delete the 3 files**

```bash
git rm client/src/pages/map/hooks/useClosestUnit.ts
git rm client/src/pages/map/hooks/useMapboxInit.ts
git rm client/src/pages/map/utils/mapboxOverlays.ts
```

- [ ] **Step 3: Typecheck and full suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no new errors, no new test failures (baseline: 423 files / 2877 tests).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(map): delete 3 confirmed-dead files with zero references anywhere

- useClosestUnit.ts: a stub whose entire body is 'return [];'
- useMapboxInit.ts: a full parallel map-init hook, superseded by
  MapCore.ts which reimplements equivalent logic inline
- mapboxOverlays.ts: a whole overlay-builder utility module (geometry
  helpers, paint helpers, MapboxOverlayManager class) -- every
  exported symbol verified to have zero importers"
```

---

### Task 8: Delete useMultiUnitRouting.ts (dead scaffolding, 2 dangling call-site lines)

**Files:**
- Delete: `client/src/hooks/useMultiUnitRouting.ts`
- Modify: `client/src/pages/map/MapboxMapPage.tsx` (remove its import + instantiation)

**Interfaces:** None. `multiRouting` (the hook's return value) is confirmed to have
zero usages anywhere after its declaration line — the real multi-stop routing
capability lives entirely in `useMapRouting`'s `showMultiStopRoute`, already wired
via `MultiStopRoutePanel`.

- [ ] **Step 1: Confirm `multiRouting` has no other usages**

```bash
grep -n "multiRouting" client/src/pages/map/MapboxMapPage.tsx
```
Expected: exactly one line (the declaration). If more than one, stop and report
BLOCKED.

- [ ] **Step 2: Remove the import and instantiation**

Find in `client/src/pages/map/MapboxMapPage.tsx`:
```tsx
import { useMultiUnitRouting } from '../../hooks/useMultiUnitRouting';
```
Delete this line.

Find:
```tsx
  const multiRouting = useMultiUnitRouting({ map: mapRef.current });
```
Delete this line.

- [ ] **Step 3: Delete the hook file**

```bash
git rm client/src/hooks/useMultiUnitRouting.ts
```

- [ ] **Step 4: Typecheck and full suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no new errors, no new test failures.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "chore(map): delete useMultiUnitRouting.ts (17-line no-op stub)

addRoute/removeRoute were literally empty function bodies. Its return
value (multiRouting) was instantiated in MapboxMapPage.tsx but never
read again -- the real multi-stop routing capability lives entirely
in useMapRouting's showMultiStopRoute, already wired via
MultiStopRoutePanel's \"Optimize & Route\" button."
```

---

### Task 9: Delete BuildingsLayer.tsx + its test (duplicate of the live 3D-buildings implementation)

**Files:**
- Delete: `client/src/pages/map/components/BuildingsLayer.tsx`
- Delete: `client/src/pages/map/components/__tests__/BuildingsLayer.test.tsx`

**Interfaces:** None. The live "3D Buildings" dock toggle (`id: 'buildings'`,
`MapboxMapPage.tsx`) is driven by `addMapbox3DBuildings`/`removeMapbox3DBuildings`
from `client/src/utils/mapboxLoader.ts` — a completely separate code path from
`BuildingsLayer.tsx`'s `useBuildingsLayer` hook, which has zero live-app
importers (confirmed: its only importer anywhere is its own test file).

- [ ] **Step 1: Confirm zero live-app importers**

```bash
grep -rln "BuildingsLayer\|useBuildingsLayer" client/src --include="*.ts" --include="*.tsx"
```
Expected: exactly 2 files — `client/src/pages/map/components/BuildingsLayer.tsx`
itself and `client/src/pages/map/components/__tests__/BuildingsLayer.test.tsx`. If
any other file appears, stop and report BLOCKED.

- [ ] **Step 2: Delete both files**

```bash
git rm client/src/pages/map/components/BuildingsLayer.tsx
git rm client/src/pages/map/components/__tests__/BuildingsLayer.test.tsx
```

- [ ] **Step 3: Typecheck and full suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no new errors; total test file count drops by exactly 1 (the deleted
test), no new failures elsewhere.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(map): delete BuildingsLayer.tsx (duplicate 3D-buildings implementation)

The live \"3D Buildings\" dock toggle uses addMapbox3DBuildings/
removeMapbox3DBuildings from utils/mapboxLoader.ts -- a completely
separate code path. BuildingsLayer.tsx's useBuildingsLayer hook had
zero importers outside its own test, which is deleted alongside it."
```

---

### Task 10: Delete useMapOptimization.ts (superseded by useMapRouting's working multi-stop optimizer)

**Files:**
- Delete: `client/src/hooks/useMapOptimization.ts`
- Modify: `client/src/pages/map/modules/MapCore.ts` (remove import, type field, call, return-spread)

**Interfaces:**
- Removes `optimization: ReturnType<typeof useMapOptimization>` from
  `UseMapCoreResult`. Confirmed safe: `MapboxMapPage.tsx`'s destructure of
  `useMapCore()` does not currently pull out `optimization` (only
  `mapContainerRef, mapRef, mapLoaded, loading, mapError, mapLibreFallback,
  changeStyle, token, daylight, projection, atmosphere, cameraAnimation, snapshot`)
  — no other task in this plan depends on `optimization` continuing to exist.

`MultiStopRoutePanel`'s existing "Optimize & Route" button already calls a
complete, working Mapbox Optimization API solve via `useMapRouting`'s
`showMultiStopRoute` (real TSP solving through `/mapbox/optimization`, rendered
route line + numbered stop markers, ETA/distance totals) — `useMapOptimization` is
a second, unused implementation of the same capability.

- [ ] **Step 1: Confirm `optimization` is not destructured in `MapboxMapPage.tsx`**

```bash
grep -n "optimization" client/src/pages/map/MapboxMapPage.tsx
```
Expected: no output. If any line appears, stop and report BLOCKED — this means
`optimization` IS consumed somewhere and this task needs re-scoping.

- [ ] **Step 2: Remove `useMapOptimization` from `MapCore.ts`**

Find:
```ts
import { useMapOptimization } from '../../../hooks/useMapOptimization';
```
Delete this line.

Find in `UseMapCoreResult`:
```ts
  snapshot: ReturnType<typeof useMapSnapshot>;
  optimization: ReturnType<typeof useMapOptimization>;
}
```
Replace with:
```ts
  snapshot: ReturnType<typeof useMapSnapshot>;
}
```

Find:
```ts
  const snapshot = useMapSnapshot();
  const optimization = useMapOptimization(mapRef.current, mapLoaded);

  return {
    mapContainerRef, mapRef, mapLoaded, loading, mapError, mapLibreFallback, changeStyle, token,
    daylight, projection, atmosphere, cameraAnimation, snapshot, optimization,
  };
}
```
Replace with:
```ts
  const snapshot = useMapSnapshot();

  return {
    mapContainerRef, mapRef, mapLoaded, loading, mapError, mapLibreFallback, changeStyle, token,
    daylight, projection, atmosphere, cameraAnimation, snapshot,
  };
}
```

- [ ] **Step 3: Delete the hook file**

```bash
git rm client/src/hooks/useMapOptimization.ts
```

- [ ] **Step 4: Typecheck and full suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no new errors, no new test failures.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/modules/MapCore.ts
git commit -m "chore(map): delete useMapOptimization.ts (redundant with useMapRouting's working optimizer)

MultiStopRoutePanel's existing \"Optimize & Route\" button already
calls a full working Mapbox Optimization API solve via useMapRouting.
useMapOptimization was a second, never-consumed implementation of the
same capability -- MapboxMapPage.tsx never destructured it from
useMapCore()."
```

---

### Task 11: Wire in GpsHud (B1)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

**Interfaces:**
- Consumes: `gps` (already `const gps = useGpsTracking({ upload: false });` at
  `MapboxMapPage.tsx:546`) and `routing` (already `useMapRouting(...)` — provides
  `routing.activeRoute`, `routing.routeProgress` per existing usage elsewhere in
  this file; verify the exact field names on `routing` before wiring `nav` below by
  checking how `routing.activeRoute`/similar is already read elsewhere in this
  file, since this plan's earlier research did not exhaustively enumerate every
  field on the `routing` object).
- `GpsHud` full props (`client/src/pages/map/components/GpsHud.tsx`):
  ```ts
  interface Props {
    gps: GpsHudData;      // structurally compatible with useGpsTracking's return (superset)
    nav?: GpsHudNav | null;  // { activeRoute: RouteInfo | null; routeProgress: RouteProgress | null; offRoute: boolean }
    onExport: (format: 'csv' | 'geojson') => void;
    onClear: () => void;
    onClose: () => void;
  }
  ```

- [ ] **Step 1: Add a `gpsHudOpen` toggle state**

Find the state declarations near the top of `MapboxMapPage.tsx` (alongside
`showBookmarksPanel`) and add:
```tsx
  const [gpsHudOpen, setGpsHudOpen] = useState(false);
```

- [ ] **Step 2: Add the GpsHud dock toggle**

Find the "Dispatch Tools" section in `mapRightDockSections` and add a new entry
after `bookmarks`:
```tsx
        { id: 'gps-hud', label: 'GPS HUD', active: gpsHudOpen, onToggle: () => setGpsHudOpen((v) => !v), color: '#22c55e', description: 'Heading, speed, route progress' },
```
Add `gpsHudOpen`, `setGpsHudOpen` to that `useMemo`'s dependency array.

- [ ] **Step 3: Import and mount `GpsHud`**

Add near the top with the other component imports:
```tsx
import GpsHud from './components/GpsHud';
```

Add the mount block alongside the other conditionally-rendered overlays (near
`{showBookmarksPanel && (...)}` from Task 5):
```tsx
      {gpsHudOpen && (
        <GpsHud
          gps={gps}
          nav={null}
          onExport={(format) => { if (format === 'csv') gps.exportTrack?.('csv'); else gps.exportTrack?.('geojson'); }}
          onClear={() => gps.clearCapturedTrack?.()}
          onClose={() => setGpsHudOpen(false)}
        />
      )}
```
`nav={null}` is intentionally the safe starting point — `GpsHud`'s `nav` prop is
optional and the component's own doc comment says "Omit or pass null when no route
is active." Wiring live turn-by-turn `nav` data through requires confirming the
exact field names `useMapRouting` exposes for the currently-active route (this
plan's research did not pin those down); if you can confirm them quickly by
reading `client/src/hooks/useMapRouting.ts`'s return statement, wire
`nav={{ activeRoute: routing.activeRoute, routeProgress: routing.routeProgress, offRoute: false }}` (or whatever the real field names are) instead — but `nav={null}`
is a complete, correct deliverable on its own (GpsHud renders its full
compass/heading/speed/accuracy view either way; only the route-progress section
is additionally gated on `nav`).

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. If `gps.exportTrack`/`gps.clearCapturedTrack` don't match
`useGpsTracking`'s actual exported method names exactly, fix the call to match
(re-check `client/src/hooks/useGpsTracking.ts`'s return statement — this plan's
research listed `getCapturedTrack, clearCapturedTrack, exportTrack` as returned
alongside the state fields, but confirm exact arity/signature before finalizing).

- [ ] **Step 5: Manual verification**

If a live Mapbox token is available: toggle "GPS HUD" from the Dispatch Tools dock
section, confirm the HUD renders (compass/heading/speed/lat-lng), and the close
button removes it. If no token is available, note as a known gap.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire in GpsHud via a new Dispatch Tools toggle

GpsHud was fully built but never mounted anywhere. Its data source
(useGpsTracking) was already flowing through MapboxMapPage.tsx --
only used for the My Position marker -- now also feeds the HUD."
```

---

### Task 12: Wire in UnifiedMapLegend + useActivityChoropleth (B2)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

**Interfaces:**
- `UnifiedMapLegend` full props (`client/src/pages/map/components/UnifiedMapLegend.tsx`):
  ```ts
  export interface UnifiedLegendProps {
    hierarchy: { area: boolean; sector: boolean; zone: boolean; beat: boolean };
    boundaries: { county: boolean; municipality: boolean };
    statewide: { roads: boolean; addresses: boolean };
    choro: ChoroLegend | null;
    categorical: { label: string; color: string }[];
    isLight: boolean;
    bottomPx?: number;
    leftCss?: string;
  }
  ```
- `useActivityChoropleth` signature (`client/src/hooks/useActivityChoropleth.ts`):
  ```ts
  interface Opts { map: mapboxgl.Map | null; calls: CallLike[]; level: ChoroLevel | null; }
  export function useActivityChoropleth({ map, calls, level }: Opts): { choroLegend: ChoroLegend | null };
  ```
- `districtHierarchy.hierarchyStates` is keyed by `'area' | 'sector' | 'zone'`
  (confirmed via `HIERARCHY_CONFIGS` in `useDistrictHierarchyLayers.ts:34-36`),
  each entry shaped `{ visible: boolean }` (per existing usage pattern
  `districtHierarchy.hierarchyStates[cfg.id]?.visible`). `geoJsonLayers.layerStates`
  is keyed by `GEO_LAYER_CONFIGS` ids, which include `'beat'`, `'county'`,
  `'municipality'` among others — no `'roads'`/`'addresses'` config exists in this
  app, so `statewide` has no real backing data; pass `{ roads: false, addresses: false }` as a fixed placeholder (this doesn't regress anything — there is
  currently no way to toggle statewide roads/addresses layers at all).

- [ ] **Step 1: Add a `legendOpen` toggle state**

```tsx
  const [legendOpen, setLegendOpen] = useState(false);
```

- [ ] **Step 2: Add a toolbar toggle for the legend**

`MapTopToolbar.tsx` needs a new prop pair. Find in
`client/src/pages/map/components/MapTopToolbar.tsx`:
```tsx
export interface MapTopToolbarProps {
  scaleEnabled: boolean;
  onToggleScale: () => void;
  fullscreenEnabled: boolean;
  onToggleFullscreen: () => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  mapStyle: MapStyleId;
  onStyleChange: (id: MapStyleId) => void;
  showBookmarksPanel: boolean;
  onToggleBookmarks: () => void;
  onSnapshot: () => void;
}
```
Replace with:
```tsx
export interface MapTopToolbarProps {
  scaleEnabled: boolean;
  onToggleScale: () => void;
  fullscreenEnabled: boolean;
  onToggleFullscreen: () => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  mapStyle: MapStyleId;
  onStyleChange: (id: MapStyleId) => void;
  showBookmarksPanel: boolean;
  onToggleBookmarks: () => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
  onSnapshot: () => void;
}
```
Find:
```tsx
export default function MapTopToolbar({
  scaleEnabled, onToggleScale, fullscreenEnabled, onToggleFullscreen,
  minimapOpen, onToggleMinimap, mapStyle, onStyleChange,
  showBookmarksPanel, onToggleBookmarks, onSnapshot,
}: MapTopToolbarProps) {
```
Replace with:
```tsx
export default function MapTopToolbar({
  scaleEnabled, onToggleScale, fullscreenEnabled, onToggleFullscreen,
  minimapOpen, onToggleMinimap, mapStyle, onStyleChange,
  showBookmarksPanel, onToggleBookmarks, legendOpen, onToggleLegend, onSnapshot,
}: MapTopToolbarProps) {
```
Find:
```tsx
      <IconButton
        aria-label={showBookmarksPanel ? 'Hide bookmarks' : 'Show bookmarks'}
        onClick={onToggleBookmarks}
        className={`${ITEM_CLASS} ${showBookmarksPanel ? 'text-brand-gold-500' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
      >
        <Star className="w-4 h-4" />
      </IconButton>
      <IconButton
        aria-label="Capture snapshot"
        onClick={onSnapshot}
        className={`${ITEM_CLASS} text-rmpg-300 hover:text-brand-gold-500`}
      >
        <Download className="w-4 h-4" />
      </IconButton>
```
Replace with:
```tsx
      <IconButton
        aria-label={showBookmarksPanel ? 'Hide bookmarks' : 'Show bookmarks'}
        onClick={onToggleBookmarks}
        className={`${ITEM_CLASS} ${showBookmarksPanel ? 'text-brand-gold-500' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
      >
        <Star className="w-4 h-4" />
      </IconButton>
      <IconButton
        aria-label={legendOpen ? 'Hide legend' : 'Show legend'}
        onClick={onToggleLegend}
        className={`${ITEM_CLASS} ${legendOpen ? 'text-brand-gold-500' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
      >
        <ListTree className="w-4 h-4" />
      </IconButton>
      <IconButton
        aria-label="Capture snapshot"
        onClick={onSnapshot}
        className={`${ITEM_CLASS} text-rmpg-300 hover:text-brand-gold-500`}
      >
        <Download className="w-4 h-4" />
      </IconButton>
```
Add `ListTree` to the `lucide-react` import at the top of `MapTopToolbar.tsx`:
```tsx
import { Ruler, Maximize, Map as MapIcon, Star, Download, ListTree } from 'lucide-react';
```

- [ ] **Step 3: Invoke `useActivityChoropleth` and pass the new props through `mapTopToolbarProps`**

Add near the other hook calls in `MapboxMapPage.tsx` (after `districtHierarchy`
and `geoJsonLayers` are already declared):
```tsx
  const activityChoropleth = useActivityChoropleth({
    map: mapRef.current,
    calls,
    level: districtHierarchy.hierarchyStates['area']?.visible ? 'area'
      : districtHierarchy.hierarchyStates['sector']?.visible ? 'sector'
      : districtHierarchy.hierarchyStates['zone']?.visible ? 'zone'
      : null,
  });
```
Add the import:
```tsx
import { useActivityChoropleth } from '../../hooks/useActivityChoropleth';
```
Find in `mapTopToolbarProps`:
```tsx
    showBookmarksPanel, onToggleBookmarks: () => setShowBookmarksPanel((v) => !v),
    onSnapshot: () => {
```
Replace with:
```tsx
    showBookmarksPanel, onToggleBookmarks: () => setShowBookmarksPanel((v) => !v),
    legendOpen, onToggleLegend: () => setLegendOpen((v) => !v),
    onSnapshot: () => {
```

- [ ] **Step 4: Mount `UnifiedMapLegend`**

Add the import:
```tsx
import UnifiedMapLegend from './components/UnifiedMapLegend';
```
Add the mount block alongside the other conditional overlays:
```tsx
      {legendOpen && (
        <UnifiedMapLegend
          hierarchy={{
            area: districtHierarchy.hierarchyStates['area']?.visible ?? false,
            sector: districtHierarchy.hierarchyStates['sector']?.visible ?? false,
            zone: districtHierarchy.hierarchyStates['zone']?.visible ?? false,
            beat: geoJsonLayers.layerStates['beat']?.visible ?? false,
          }}
          boundaries={{
            county: geoJsonLayers.layerStates['county']?.visible ?? false,
            municipality: geoJsonLayers.layerStates['municipality']?.visible ?? false,
          }}
          statewide={{ roads: false, addresses: false }}
          choro={activityChoropleth.choroLegend}
          categorical={[]}
          isLight={false}
        />
      )}
```
`isLight={false}` — the Map tab is a `.tactical-dark` surface that stays dark
always (per this repo's established "tactical surfaces stay dark" rule), so the
legend's light/dark variant should always be the dark one here. `categorical={[]}`
is a deliberately minimal starting value (an empty list renders no categorical
swatches) — populating it with real per-level color data is a nice-to-have not
required for this component to render correctly, since `choro`/`hierarchy`/
`boundaries` already carry the primary legend content.

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. Double-check `districtHierarchy.hierarchyStates` and
`geoJsonLayers.layerStates`'s exact keying (string-indexed record vs. typed enum
keys) compiles cleanly with the bracket-access pattern above — if TypeScript
complains about implicit `any` on the bracket access, add an explicit
`Record<string, { visible: boolean }>` cast or adjust to whatever the hooks'
actual declared return types are.

- [ ] **Step 6: Manual verification**

If a live Mapbox token is available: toggle the new legend icon in the top
toolbar, confirm `UnifiedMapLegend` renders bottom-left without crashing (some
sections may show all-empty/all-gray if no boundary/hierarchy layer is currently
active — that's expected, not a bug). If no token available, note as a known gap.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx client/src/pages/map/components/MapTopToolbar.tsx
git commit -m "feat(map): wire in UnifiedMapLegend via a new top-toolbar toggle

Also invokes useActivityChoropleth (previously uncalled anywhere) to
supply the legend's choropleth swatches. statewide roads/addresses
have no backing layer in this app today, so that section is a fixed
{false,false} placeholder rather than a regression."
```

---

### Task 13: Wire in MapDiagnosticsOverlay (B3)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

**Interfaces:**
- `MapDiagnosticsOverlay` full props (`client/src/pages/map/components/MapDiagnosticsOverlay.tsx`):
  ```ts
  interface Props { map: mapboxgl.Map; }
  ```
  (non-null — caller must guard on a loaded map before rendering).

- [ ] **Step 1: Add a `diagnosticsOpen` toggle state**

```tsx
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
```

- [ ] **Step 2: Add the dock toggle in the "Diagnostics" section**

Find in `mapRightDockSections`:
```tsx
      title: 'Diagnostics',
      items: [
        { id: 'inspect', label: 'Feature Inspector', active: featureInspect.enabled, onToggle: featureInspect.toggle, color: '#8b5cf6', description: 'Click features for details' },
        { id: 'mapmatch', label: 'Map Match Trace', active: mapMatchTrace.collecting, onToggle: () => mapMatchTrace.collecting ? mapMatchTrace.clear() : mapMatchTrace.startCollecting(), color: '#fb923c', description: 'Snap GPS to roads' },
        { id: 'deck', label: 'GPU Overlay', active: deckEnabled, onToggle: () => setDeckEnabled((v: boolean) => !v), color: '#a855f7', description: 'Deck.gl accelerated rendering' },
      ],
    },
```
Replace with:
```tsx
      title: 'Diagnostics',
      items: [
        { id: 'inspect', label: 'Feature Inspector', active: featureInspect.enabled, onToggle: featureInspect.toggle, color: '#8b5cf6', description: 'Click features for details' },
        { id: 'mapmatch', label: 'Map Match Trace', active: mapMatchTrace.collecting, onToggle: () => mapMatchTrace.collecting ? mapMatchTrace.clear() : mapMatchTrace.startCollecting(), color: '#fb923c', description: 'Snap GPS to roads' },
        { id: 'deck', label: 'GPU Overlay', active: deckEnabled, onToggle: () => setDeckEnabled((v: boolean) => !v), color: '#a855f7', description: 'Deck.gl accelerated rendering' },
        { id: 'perf-hud', label: 'Performance HUD', active: diagnosticsOpen, onToggle: () => setDiagnosticsOpen((v) => !v), color: '#fb923c', description: 'FPS, layer count, render timing' },
      ],
    },
```
Add `diagnosticsOpen`, `setDiagnosticsOpen` to that `useMemo`'s dependency array.

- [ ] **Step 3: Mount `MapDiagnosticsOverlay`**

Add the import:
```tsx
import MapDiagnosticsOverlay from './components/MapDiagnosticsOverlay';
```
Add the mount block:
```tsx
      {diagnosticsOpen && mapRef.current && (
        <MapDiagnosticsOverlay map={mapRef.current} />
      )}
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

If a live Mapbox token is available: toggle "Performance HUD" from the right
dock's Diagnostics section, confirm it renders live zoom/pitch/bearing/FPS values
that update as you pan/zoom. If no token available, note as a known gap.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire in MapDiagnosticsOverlay via the Diagnostics dock section

Live perf HUD (zoom/pitch/bearing, layer count, FPS, render timing)
was fully built with zero mount points anywhere in the app."
```

---

### Task 14: Build the snapshot gallery popover (B4)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

**Interfaces:**
- Consumes: `snapshot` (already destructured from `useMapCore()`) —
  `snapshot.snapshots: SnapshotResult[]`, `snapshot.removeSnapshot(timestamp: number): void`,
  `snapshot.clearSnapshots(): void`. `SnapshotResult` shape
  (`client/src/hooks/useMapSnapshot.ts`):
  ```ts
  export interface SnapshotResult {
    url: string;       // Static-Images-API URL, doubles as the thumbnail src
    config: SnapshotConfig;
    timestamp: number;
  }
  ```

- [ ] **Step 1: Add a `snapshotGalleryOpen` toggle state**

```tsx
  const [snapshotGalleryOpen, setSnapshotGalleryOpen] = useState(false);
```

- [ ] **Step 2: Make the toolbar's snapshot button toggle the gallery too**

Snapshots are captured via `onSnapshot` in `mapTopToolbarProps` — keep that
capture behavior, but also open the gallery so the operator sees the result
immediately instead of it vanishing with no feedback. Find:
```tsx
    onSnapshot: () => {
      const c = mapRef.current?.getCenter();
      if (c) snapshot.captureSnapshot({ lng: c.lng, lat: c.lat, zoom: mapRef.current?.getZoom() ?? 14 });
    },
```
Replace with:
```tsx
    onSnapshot: () => {
      const c = mapRef.current?.getCenter();
      if (c) snapshot.captureSnapshot({ lng: c.lng, lat: c.lat, zoom: mapRef.current?.getZoom() ?? 14 });
      setSnapshotGalleryOpen(true);
    },
```

- [ ] **Step 3: Render the gallery popover**

Add near the other conditional overlays:
```tsx
      {snapshotGalleryOpen && (
        <div
          className="absolute top-11 right-3 z-30 bg-surface-raised/95 border border-border-default backdrop-blur-sm font-mono overflow-hidden"
          style={{ borderRadius: 2, width: 220, maxHeight: 340, boxShadow: '0 8px 28px rgba(0,0,0,0.55)' }}
        >
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border-subtle">
            <span className="text-[10px] font-black tracking-wider text-brand-gold-500 flex-1 uppercase">
              Snapshots
            </span>
            {snapshot.snapshots.length > 0 && (
              <button
                onClick={() => snapshot.clearSnapshots()}
                aria-label="Clear all snapshots"
                className="text-[8px] text-rmpg-500 hover:text-red-400 uppercase tracking-wider"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setSnapshotGalleryOpen(false)}
              aria-label="Close snapshot gallery"
              className="text-rmpg-500 hover:text-rmpg-300 flex"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="scrollbar-dark overflow-y-auto p-2 grid grid-cols-2 gap-2" style={{ maxHeight: 280 }}>
            {snapshot.snapshots.length === 0 ? (
              <div className="col-span-2 text-[10px] text-rmpg-500 py-2 text-center">
                No snapshots yet.
              </div>
            ) : (
              snapshot.snapshots.map((s) => (
                <div key={s.timestamp} className="relative group">
                  <img
                    src={s.url}
                    alt={`Snapshot at ${new Date(s.timestamp).toLocaleTimeString()}`}
                    className="w-full h-auto border border-border-subtle"
                    style={{ borderRadius: 2 }}
                  />
                  <button
                    onClick={() => snapshot.removeSnapshot(s.timestamp)}
                    aria-label="Remove snapshot"
                    className="absolute top-0.5 right-0.5 bg-surface-base/90 text-rmpg-400 hover:text-red-400 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ borderRadius: 2 }}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

If a live Mapbox token is available: click "Capture Snapshot" in the top toolbar,
confirm the gallery popover opens showing a thumbnail of the captured view;
confirm the remove (X) button and "Clear" button both work. If no token
available, note as a known gap (the Static Images API call itself also requires a
valid token to return real image data).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): add a snapshot gallery popover

Capture Snapshot fired an API call and threw the result away with
zero feedback -- useMapSnapshot already kept the last 10 in a
snapshots array, nothing ever read it. Clicking Capture now also
opens a small gallery showing what was captured, with remove/clear."
```

---

### Task 15: Wire in useMapPrintExport as an "Export Image" button (B6)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`, `client/src/pages/map/components/MapTopToolbar.tsx`

**Interfaces:**
- `printExport` (already `const printExport = useMapPrintExport(mapRef.current, mapLoaded);` at
  `MapboxMapPage.tsx:566`, but never destructured out or read anywhere) — needs to
  be passed through to `mapTopToolbarProps`. Full shape
  (`client/src/hooks/useMapPrintExport.ts`):
  ```ts
  { exporting: boolean; exportImage: (options?: { filename?: string; includeWatermark?: boolean; format?: 'png' | 'jpeg'; quality?: number }) => Promise<void>; copyToClipboard: () => Promise<void>; }
  ```

- [ ] **Step 1: Add an "Export Image" prop pair to `MapTopToolbarProps`**

Find (as left by Task 12's edit):
```tsx
export interface MapTopToolbarProps {
  scaleEnabled: boolean;
  onToggleScale: () => void;
  fullscreenEnabled: boolean;
  onToggleFullscreen: () => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  mapStyle: MapStyleId;
  onStyleChange: (id: MapStyleId) => void;
  showBookmarksPanel: boolean;
  onToggleBookmarks: () => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
  onSnapshot: () => void;
}
```
Replace with:
```tsx
export interface MapTopToolbarProps {
  scaleEnabled: boolean;
  onToggleScale: () => void;
  fullscreenEnabled: boolean;
  onToggleFullscreen: () => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  mapStyle: MapStyleId;
  onStyleChange: (id: MapStyleId) => void;
  showBookmarksPanel: boolean;
  onToggleBookmarks: () => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
  onSnapshot: () => void;
  onExportImage: () => void;
}
```
Find:
```tsx
export default function MapTopToolbar({
  scaleEnabled, onToggleScale, fullscreenEnabled, onToggleFullscreen,
  minimapOpen, onToggleMinimap, mapStyle, onStyleChange,
  showBookmarksPanel, onToggleBookmarks, legendOpen, onToggleLegend, onSnapshot,
}: MapTopToolbarProps) {
```
Replace with:
```tsx
export default function MapTopToolbar({
  scaleEnabled, onToggleScale, fullscreenEnabled, onToggleFullscreen,
  minimapOpen, onToggleMinimap, mapStyle, onStyleChange,
  showBookmarksPanel, onToggleBookmarks, legendOpen, onToggleLegend, onSnapshot,
  onExportImage,
}: MapTopToolbarProps) {
```
Find:
```tsx
      <IconButton
        aria-label="Capture snapshot"
        onClick={onSnapshot}
        className={`${ITEM_CLASS} text-rmpg-300 hover:text-brand-gold-500`}
      >
        <Download className="w-4 h-4" />
      </IconButton>
```
Replace with:
```tsx
      <IconButton
        aria-label="Capture snapshot"
        onClick={onSnapshot}
        className={`${ITEM_CLASS} text-rmpg-300 hover:text-brand-gold-500`}
      >
        <Download className="w-4 h-4" />
      </IconButton>
      <IconButton
        aria-label="Export map image"
        onClick={onExportImage}
        className={`${ITEM_CLASS} text-rmpg-300 hover:text-brand-gold-500`}
      >
        <ImageDown className="w-4 h-4" />
      </IconButton>
```
Add `ImageDown` to the `lucide-react` import:
```tsx
import { Ruler, Maximize, Map as MapIcon, Star, Download, ListTree, ImageDown } from 'lucide-react';
```

- [ ] **Step 2: Wire `onExportImage` in `MapboxMapPage.tsx`**

Find in `mapTopToolbarProps`:
```tsx
    legendOpen, onToggleLegend: () => setLegendOpen((v) => !v),
    onSnapshot: () => {
      const c = mapRef.current?.getCenter();
      if (c) snapshot.captureSnapshot({ lng: c.lng, lat: c.lat, zoom: mapRef.current?.getZoom() ?? 14 });
      setSnapshotGalleryOpen(true);
    },
```
Replace with:
```tsx
    legendOpen, onToggleLegend: () => setLegendOpen((v) => !v),
    onSnapshot: () => {
      const c = mapRef.current?.getCenter();
      if (c) snapshot.captureSnapshot({ lng: c.lng, lat: c.lat, zoom: mapRef.current?.getZoom() ?? 14 });
      setSnapshotGalleryOpen(true);
    },
    onExportImage: () => { void printExport.exportImage(); },
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

If a live Mapbox token is available: click the new "Export map image" button,
confirm a watermarked PNG downloads (distinct from the low-res gallery preview
from Task 14). If no token available, note as a known gap.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx client/src/pages/map/components/MapTopToolbar.tsx
git commit -m "feat(map): add an Export Image button for the unused useMapPrintExport hook

Self-contained client-side watermarked canvas download -- fully
implemented (exportImage/copyToClipboard) but never called anywhere.
Distinct from the Capture Snapshot gallery (server-side Static Images
API preview) -- both are worth keeping for different use cases."
```

---

### Task 16: Wire the Identify tool's click handler through useMapInfoPanel (B7)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

**Interfaces:**
- `useMapInfoPanel` full API (`client/src/hooks/useMapInfoPanel.ts`):
  ```ts
  export function useMapInfoPanel(
    map: mapboxgl.Map | null, mapLoaded: boolean,
    units: Array<{ id: string; call_sign: string; latitude: number | null; longitude: number | null; status: string }>,
    calls: Array<{ id: string; call_number: string; latitude: number | null; longitude: number | null; priority: string; incident_type: string }>,
  ): {
    panel: InfoPanelData | null;
    showPanel: (data: InfoPanelData) => void;
    closePanel: () => void;
    showLocationInfo: (lng: number, lat: number) => void;
    loading: boolean;
  }
  ```
  `showLocationInfo(lng, lat)` internally builds and calls `showPanel` with a
  `'location'`-typed `InfoPanelData` (reverse-geocoded address, nearby
  units/calls within 5mi, weather) — it manages its own popup rendering
  internally via `panel` state, it does NOT return a Mapbox `Popup` object to
  attach manually.

The current Identify click handler builds its own bespoke popup via
`tilequery.queryFromMapClick(e)` (city/county/state + a Street View button). This
task keeps that popup exactly as-is (its Street View integration has real value
and isn't part of this spec) and ADDS `useMapInfoPanel`'s richer nearby/weather
data as a second, complementary popup triggered by the same click — rather than
replacing the existing one, since `useMapInfoPanel` doesn't expose a raw `Popup`
object to merge into the tilequery HTML string.

- [ ] **Step 1: Instantiate `useMapInfoPanel`**

Add near the other hook calls in `MapboxMapPage.tsx`:
```tsx
  const infoPanel = useMapInfoPanel(mapRef.current, mapLoaded, units, calls);
```
Add the import:
```tsx
import { useMapInfoPanel } from '../../hooks/useMapInfoPanel';
```

- [ ] **Step 2: Call `showLocationInfo` from the Identify click handler**

Find the Identify click handler:
```tsx
  useEffect(() => {
    const map = mapRef.current;
    if (!identifyEnabled || !map) return;

    const handler = async (e: mapboxgl.MapMouseEvent) => {
      const info = await tilequery.queryFromMapClick(e);
      if (identifyPopupRef.current) { identifyPopupRef.current.remove(); identifyPopupRef.current = null; }
      if (!info) return;
      const { lng, lat } = e.lngLat;
```
Replace with:
```tsx
  useEffect(() => {
    const map = mapRef.current;
    if (!identifyEnabled || !map) return;

    const handler = async (e: mapboxgl.MapMouseEvent) => {
      const info = await tilequery.queryFromMapClick(e);
      if (identifyPopupRef.current) { identifyPopupRef.current.remove(); identifyPopupRef.current = null; }
      infoPanel.showLocationInfo(e.lngLat.lng, e.lngLat.lat);
      if (!info) return;
      const { lng, lat } = e.lngLat;
```
(`infoPanel.showLocationInfo` is called unconditionally on every Identify click,
regardless of whether `tilequery` found place data — nearby units/calls/weather
is independently useful even when there's no city/county/state hit.)

- [ ] **Step 3: Render `infoPanel.panel` when populated**

`useMapInfoPanel` manages its own `panel` state but (per this plan's research)
does not automatically render a popup itself — it exposes `panel: InfoPanelData | null` for the caller to render. Add a render block near the other
conditional overlays:
```tsx
      {infoPanel.panel && (
        <div
          className="absolute bottom-14 left-1/2 -translate-x-1/2 z-40 bg-surface-raised/95 border border-border-default backdrop-blur-sm font-mono text-[11px] text-rmpg-200"
          style={{ borderRadius: 2, width: 280, boxShadow: '0 8px 28px rgba(0,0,0,0.55)' }}
        >
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border-subtle">
            <div>
              <div className="text-brand-gold-500 font-bold text-[11px]">{infoPanel.panel.title}</div>
              {infoPanel.panel.subtitle && <div className="text-rmpg-500 text-[9px]">{infoPanel.panel.subtitle}</div>}
            </div>
            <button onClick={infoPanel.closePanel} aria-label="Close location info" className="text-rmpg-500 hover:text-rmpg-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-2.5 py-2 space-y-1.5">
            {infoPanel.loading && <div className="text-rmpg-500 text-[10px]">Loading nearby info…</div>}
            {infoPanel.panel.weather && (
              <div className="text-[10px]">
                {infoPanel.panel.weather.condition}, {infoPanel.panel.weather.temp} · Wind {infoPanel.panel.weather.wind}
              </div>
            )}
            {infoPanel.panel.nearby && infoPanel.panel.nearby.length > 0 && (
              <div className="space-y-0.5">
                <div className="text-[8px] text-rmpg-500 uppercase tracking-wider">Nearby</div>
                {infoPanel.panel.nearby.slice(0, 5).map((n) => (
                  <div key={`${n.type}-${n.id}`} className="flex justify-between text-[10px]">
                    <span style={{ color: n.color || undefined }}>{n.label}</span>
                    <span className="text-rmpg-500">{n.distance}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

If a live Mapbox token is available: enable Identify from the Dispatch Tools dock,
click the map, confirm BOTH the existing city/county/state popup AND the new
nearby-units/weather card appear. If no token available, note as a known gap.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire useMapInfoPanel into the Identify tool

useMapInfoPanel was fully built (nearby units/calls within 5mi,
reverse-geocoded address, weather) but instantiated once and never
called anywhere. The existing Identify click handler now also calls
showLocationInfo alongside its existing tilequery-based place-info
popup, rendering nearby/weather data in a second small card."
```

---

### Task 17: Update `_ORPHANS.md`

**Files:**
- Modify: `client/src/pages/map/_ORPHANS.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Remove the stale `SpeedGraphOverlay` row**

Find in the "Orphan panels" table:
```
| `SpeedGraphOverlay`      | — | Per-unit speed graph over time |
```
Delete this line — `SpeedGraphOverlay` is imported and mounted in
`MapboxMapPage.tsx` (predates this plan; part of the recent dock-reorg work), so
it is not orphaned.

- [ ] **Step 2: Add the 2 newly-discovered orphans this plan leaves untouched**

Add two new rows to the "Orphan panels" table (anywhere alphabetically
appropriate — e.g. near the `M`-prefixed entries):
```
| `MapboxDispatchConnections` | — | Mapbox-API diagnostics/demo panel (Directions/Matrix/Geocoding/Isochrone/Map-Matching status) |
| `ToolbarDropdownGroup`      | — | Generic reusable collapsible toolbar-section wrapper |
```

- [ ] **Step 3: Add a short note at the top marking this audit's date**

Find:
```
**Last audited: 2026-06-22.**
```
Replace with:
```
**Last audited: 2026-06-22. Partial re-audit 2026-07-20** (see
`docs/superpowers/specs/2026-07-20-map-real-bugs-and-orphan-cleanup-design.md`) —
`GpsHud`, `UnifiedMapLegend`, and `MapDiagnosticsOverlay` were wired in (they had
no rows in this doc to begin with); `SpeedGraphOverlay`'s stale row was removed;
`MapboxDispatchConnections` and `ToolbarDropdownGroup` were added as
newly-discovered orphans. The other ~26 panels/hooks below were not touched.
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/map/_ORPHANS.md
git commit -m "docs(map): update _ORPHANS.md for this pass's wire-ins and deletions

Removed the stale SpeedGraphOverlay row (already wired), added
MapboxDispatchConnections + ToolbarDropdownGroup as newly-discovered
orphans this audit found but left untouched."
```

---

### Task 18: Full-suite verification + final typecheck sweep

**Files:** None — verification only.

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: clean (no output beyond the tsc invocation echo).

- [ ] **Step 2: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Full client test suite**

Run: `cd client && npx vitest run`
Expected: all passing, file/test counts should be: baseline 423 files / 2877 tests,
minus 1 file for the deleted `BuildingsLayer.test.tsx` (Task 9), plus 1 new file
for `useMapKeyboardShortcuts.test.ts` if it didn't already exist (Task 3), plus new
test cases inside `SpeedGraphOverlay.test.tsx` (Task 6) — net file count should be
423 (if `useMapKeyboardShortcuts.test.ts` already existed) or 424 (if newly
created), with more total test cases than the 2877 baseline.

- [ ] **Step 4: Confirm no orphaned references remain from any deletion**

```bash
grep -rn "useClosestUnit\|useMapboxInit\|mapboxOverlays\|useMultiUnitRouting\|useMapOptimization\|BuildingsLayer\|useBuildingsLayer" client/src --include="*.ts" --include="*.tsx"
```
Expected: no output (all 6 deleted files' names should be fully gone from the
codebase — this catches any stray import this plan's individual tasks missed).

- [ ] **Step 5: Report**

If all four checks pass clean, this plan is complete and ready for the final
whole-branch review per `superpowers:subagent-driven-development`. If Step 4
surfaces any stray reference, fix it as part of this task before considering the
plan done (not a separate task — it's cleanup for an earlier task's own deletion).
