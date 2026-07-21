# Wire Up MapboxDispatchConnections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount the fully-built, never-wired `MapboxDispatchConnections` diagnostics panel onto the Map tab, fed by real live data instead of sitting orphaned.

**Architecture:** A new Diagnostics-section dock toggle mounts the component, bound to the Route Optimizer queue's current call and a real Mapbox Matrix API ranking (`useMapRouting`'s already-working `findClosestUnit`) computed on-demand only while the panel is open.

**Tech Stack:** React 18 + TypeScript + Vite, Mapbox GL JS v3.

## Global Constraints

- 2px border radius via `style={{ borderRadius: 2 }}` for any new JSX this plan adds directly (not `MapboxDispatchConnections.tsx`'s internals, which are out of scope and untouched).
- No hardcoded hex colors in new JSX — not applicable here; the only new JSX is a conditional component mount, no new styled elements.
- **All distances user-facing anywhere on the Map tab are miles/feet, never kilometers.** The rest of the codebase already follows this (`fmtMiles`/`fmtEta` throughout `useMapRouting.ts`; `BufferRingTool.tsx`'s ft/mi toggle — its one `units: 'kilometers'` is an internal parameter to a turf.js geometry call, never displayed). This plan's Task 2 removes one leftover dead function that formatted distance in km, so no km-formatting code remains anywhere in this file, used or not.
- No changes to `client/src/pages/map/components/MapboxDispatchConnections.tsx`, `client/src/utils/mapboxRouting.ts`, or `useMapRouting.ts`'s `findClosestUnit`/`fmtMiles`/`fmtEta` — all already correct and complete.

---

### Task 1: Wire MapboxDispatchConnections into the Diagnostics dock

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

**Interfaces:**
- Consumes: `routing.findClosestUnit(units: {callSign: string; lat: number; lng: number}[], dest: {lat: number; lng: number}): Promise<UnitDriveTime[]>` where `UnitDriveTime = { callSign: string; etaSec: number; etaText: string; distanceMeters: number; distanceText: string }` (already exported from `client/src/hooks/useMapRouting.ts`, already instantiated as `routing` in this file). Consumes `multiStopQueue: QueuedStop[]` (`{ callNumber: string; lat: number; lng: number; label?: string }`, already declared at line 345). Consumes `calls: ActiveCall[]` and `units: MapUnit[]` (both already declared). Consumes `directionsPanel.result` (already declared, already used elsewhere in this file for the "Live Directions" dock entry's `active` field).
- Produces: nothing new for later tasks — this is the final wiring task for this component.

- [ ] **Step 1: Add state for the panel's open/closed flag and its computed ranking**

Find the state declaration for `diagnosticsOpen` in `client/src/pages/map/MapboxMapPage.tsx`:
```tsx
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
```
Immediately after it, add:
```tsx
  const [dispatchConnectionsOpen, setDispatchConnectionsOpen] = useState(false);
  const [dispatchConnResults, setDispatchConnResults] = useState<ClosestUnitResult[]>([]);
```
`ClosestUnitResult` is not currently exported from `MapboxDispatchConnections.tsx` (it's declared as a local, non-exported interface there) — since this plan does not modify that file, declare the identical shape locally in `MapboxMapPage.tsx` right above this new state:
```tsx
  interface ClosestUnitResult {
    unit: { id: string; call_sign: string; latitude: number | null; longitude: number | null; status: string };
    distance: number;
    duration: number;
  }
  const [dispatchConnectionsOpen, setDispatchConnectionsOpen] = useState(false);
  const [dispatchConnResults, setDispatchConnResults] = useState<ClosestUnitResult[]>([]);
```
(Declaring an `interface` inside a function component body is unusual but harmless in TypeScript — it's scoped to the component and re-declared identically on every render, which the compiler elides to nothing at runtime. If your editor/linter flags this, an equally correct alternative is to declare it once at module scope above the component instead — either is acceptable, but keep it out of a per-render closure that captures anything, since interfaces can't do that anyway.)

- [ ] **Step 2: Compute the bound call from the Route Optimizer queue**

Add this derived value near the other `useMemo`s in the file (any point after `multiStopQueue` and `calls` are both in scope):
```tsx
  const dispatchConnCall = useMemo(
    () => (multiStopQueue.length > 0 ? calls.find((c) => c.call_number === multiStopQueue[0].callNumber) : undefined),
    [multiStopQueue, calls],
  );
```

- [ ] **Step 3: Compute the Matrix API ranking only while the panel is open**

Add this effect near the other data-fetching effects in the file:
```tsx
  useEffect(() => {
    if (!dispatchConnectionsOpen || !dispatchConnCall || dispatchConnCall.latitude == null || dispatchConnCall.longitude == null) {
      setDispatchConnResults([]);
      return;
    }
    let cancelled = false;
    const unitsForMatrix = units
      .filter((u) => u.latitude != null && u.longitude != null)
      .map((u) => ({ callSign: u.call_sign, lat: u.latitude!, lng: u.longitude! }));
    if (!unitsForMatrix.length) {
      setDispatchConnResults([]);
      return;
    }
    routing.findClosestUnit(unitsForMatrix, { lat: dispatchConnCall.latitude, lng: dispatchConnCall.longitude })
      .then((ranked) => {
        if (cancelled) return;
        const adapted: ClosestUnitResult[] = ranked
          .map((r) => {
            const unit = units.find((u) => u.call_sign === r.callSign);
            if (!unit) return null;
            return { unit, distance: r.distanceMeters, duration: r.etaSec };
          })
          .filter((r): r is ClosestUnitResult => r !== null);
        setDispatchConnResults(adapted);
      });
    return () => { cancelled = true; };
  }, [dispatchConnectionsOpen, dispatchConnCall, units, routing]);
```
The `cancelled` flag prevents a stale, slower Matrix response from overwriting a newer one if the bound call changes while a request is in flight — the same guard pattern already used by other async effects in this file (e.g. the data-fetch effect further up).

- [ ] **Step 4: Add the dock entry**

Find in `mapRightDockSections`'s "Diagnostics" section:
```tsx
        { id: 'perf-hud', label: 'Performance HUD', active: diagnosticsOpen, onToggle: () => setDiagnosticsOpen((v) => !v), color: '#fb923c', description: 'FPS, layer count, render timing' },
      ],
    },
```
Replace with:
```tsx
        { id: 'perf-hud', label: 'Performance HUD', active: diagnosticsOpen, onToggle: () => setDiagnosticsOpen((v) => !v), color: '#fb923c', description: 'FPS, layer count, render timing' },
        { id: 'mapbox-status', label: 'Mapbox API Status', active: dispatchConnectionsOpen, onToggle: () => setDispatchConnectionsOpen((v) => !v), color: '#60a5fa', description: 'Directions/Matrix/Geocoding diagnostics for the queued call' },
      ],
    },
```
Add `dispatchConnectionsOpen`, `setDispatchConnectionsOpen` to that `useMemo`'s dependency array. Find:
```tsx
  ], [directionsPanel, placesSearch, mapBookmarks, multiStopPanelOpen, speedAnalyticsPanelOpen, speedZoneStats.loading, activeFloatingTool, measure.mode, drawing.mode, glDraw, identifyEnabled, tilequery.loading, featureInspect, mapMatchTrace, deckEnabled, deckSupportsProjection, setDeckEnabled, gpsHudOpen, setGpsHudOpen, diagnosticsOpen, setDiagnosticsOpen]);
```
Replace with:
```tsx
  ], [directionsPanel, placesSearch, mapBookmarks, multiStopPanelOpen, speedAnalyticsPanelOpen, speedZoneStats.loading, activeFloatingTool, measure.mode, drawing.mode, glDraw, identifyEnabled, tilequery.loading, featureInspect, mapMatchTrace, deckEnabled, deckSupportsProjection, setDeckEnabled, gpsHudOpen, setGpsHudOpen, diagnosticsOpen, setDiagnosticsOpen, dispatchConnectionsOpen, setDispatchConnectionsOpen]);
```

- [ ] **Step 5: Import and mount the component**

Add near the other component imports (alongside `GpsHud`/`MapDiagnosticsOverlay`):
```tsx
import MapboxDispatchConnections from './components/MapboxDispatchConnections';
```
Add the mount block alongside the other conditionally-rendered overlays (e.g. next to the `{diagnosticsOpen && mapRef.current && (<MapDiagnosticsOverlay .../>)}` block):
```tsx
      {dispatchConnectionsOpen && (
        <MapboxDispatchConnections
          call={dispatchConnCall}
          results={dispatchConnResults}
          matrixActive={dispatchConnResults.length > 0}
          directionsActive={directionsPanel.result !== null}
        />
      )}
```

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. In particular confirm `ClosestUnitResult`'s locally-declared shape in `MapboxMapPage.tsx` structurally matches the one `MapboxDispatchConnections.tsx` declares internally (TypeScript checks this structurally, not by name, so as long as both interfaces have identical field names/types this passes with no import needed between the two files).

- [ ] **Step 7: Manual verification**

If a live Mapbox token is available: queue a call in the Route Optimizer, then toggle "Mapbox API Status" from the Diagnostics dock section — confirm the panel shows "Connected" (assuming a token is configured), the queued call's info is available to the action buttons (they should show `enabled` instead of disabled/grayed), and clicking "Best Route" or "Validate Address" produces a result in the panel's status line. Toggle the panel closed and confirm no further Matrix API calls fire (check the Network tab or a `console.log` temporarily if needed — remove it before committing). If no token is available in this environment, note that as a known gap in the task report (matches this repo's established pattern for Map-tab work when a token isn't configured locally).

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire in MapboxDispatchConnections via a new Diagnostics toggle

Bound to the Route Optimizer queue's current call and a real Mapbox
Matrix API ranking (routing.findClosestUnit, already instantiated but
never used for this) computed only while the panel is open. Every
action button already called a real, working mapboxRouting.ts
function -- this was pure orphaned-component wiring."
```

---

### Task 2: Delete the dead km-formatting function in useMapRouting.ts

**Files:**
- Modify: `client/src/hooks/useMapRouting.ts`

**Interfaces:** None — `parseDistance` has zero call sites anywhere in the codebase (verified via `grep -n "parseDistance(" client/src/hooks/useMapRouting.ts`, which returns only its own declaration line). No other task depends on it.

- [ ] **Step 1: Confirm zero call sites (defensive re-check before deleting)**

```bash
grep -rn "parseDistance" client/src --include="*.ts" --include="*.tsx"
```
Expected: exactly one line (the function's own declaration in `useMapRouting.ts`). If any other line appears, stop — this task needs re-scoping, don't delete a function that's actually called somewhere.

- [ ] **Step 2: Delete the function**

Find in `client/src/hooks/useMapRouting.ts`:
```ts
function parseDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
```
Delete this block entirely. Check the line immediately above and below it (likely the sibling `parseDuration` function and the `SOURCE_ID`/`LAYER_ID` constants) to confirm you're removing only this one function, not accidentally including a neighbor.

- [ ] **Step 3: Typecheck and full suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no new errors, no new test failures.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useMapRouting.ts
git commit -m "chore(map): delete dead km-formatting helper in useMapRouting.ts

parseDistance() had zero call sites -- fmtMiles/fmtEta are used
everywhere real distance/duration text is produced in this file. Its
kilometers formatting was the one leftover km-producing code path on
the Map tab; removing it means no km-formatting code remains anywhere
in this file, used or not."
```

---

### Task 3: Update `_ORPHANS.md`

**Files:**
- Modify: `client/src/pages/map/_ORPHANS.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Remove the MapboxDispatchConnections row**

Find in the "Orphan panels" table:
```
| `MapboxDispatchConnections` | — | Mapbox-API diagnostics/demo panel (Directions/Matrix/Geocoding/Isochrone/Map-Matching status) |
```
Delete this line — it's no longer orphaned once Task 1 lands. Leave every other row untouched (in particular, do not touch `ToolbarDropdownGroup`'s row, added in the same prior pass — it remains genuinely orphaned).

- [ ] **Step 2: Update the audit note**

Find the "Last audited" line at the top of the file (it currently mentions this file's most recent partial re-audit). Add one clause noting this pass, e.g. if it currently reads:
```
**Last audited: 2026-06-22. Partial re-audit 2026-07-20** (see
`docs/superpowers/specs/2026-07-20-map-real-bugs-and-orphan-cleanup-design.md`) —
`GpsHud`, `UnifiedMapLegend`, and `MapDiagnosticsOverlay` were wired in (they had
no rows in this doc to begin with); `SpeedGraphOverlay`'s stale row was removed;
`MapboxDispatchConnections` and `ToolbarDropdownGroup` were added as
newly-discovered orphans. The other ~26 panels/hooks below were not touched.
```
Replace with:
```
**Last audited: 2026-06-22. Partial re-audits 2026-07-20 and 2026-07-21** (see
`docs/superpowers/specs/2026-07-20-map-real-bugs-and-orphan-cleanup-design.md`
and `docs/superpowers/specs/2026-07-21-mapbox-dispatch-connections-integration-design.md`) —
`GpsHud`, `UnifiedMapLegend`, `MapDiagnosticsOverlay`, and `MapboxDispatchConnections`
were wired in (the first three had no rows in this doc to begin with);
`SpeedGraphOverlay`'s stale row was removed; `ToolbarDropdownGroup` was added as a
newly-discovered orphan and remains untouched. The other ~26 panels/hooks below
were not touched.
```
(Read the file first to get the exact current text — this plan's quoted "find" text is what Task 17 of the prior plan produced; if the file has drifted from this exact wording, match the intent — remove the now-wired component from the list and add one clause noting this pass happened — rather than failing on an exact-string mismatch.)

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/map/_ORPHANS.md
git commit -m "docs(map): remove MapboxDispatchConnections from _ORPHANS.md

Wired in by this pass (see Task 1) -- no longer orphaned."
```

---

### Task 4: Final verification sweep

**Files:** None — verification only.

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 2: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Full client test suite**

Run: `cd client && npx vitest run`
Expected: all passing, no new failures against whatever the baseline was immediately before this plan started.

- [ ] **Step 4: Confirm no kilometers-formatting code remains anywhere in the Map tab**

```bash
grep -rn "kilomet\|toFixed.*km\|} km\`" client/src/pages/map/ client/src/hooks/useMapRouting.ts client/src/hooks/useMapDaylight.ts client/src/hooks/useMapHeatmap.ts client/src/hooks/useMapClustering.ts 2>/dev/null
```
Expected: no output, OR only the single known, non-user-facing `units: 'kilometers'` parameter to turf's `circle()` call in `BufferRingTool.tsx` (an internal geometry-library parameter, not a distance ever displayed to a user — confirm by reading that line's surrounding context if it appears, rather than assuming it's a violation).

- [ ] **Step 5: Report**

If all four checks pass clean, this plan is complete. Proceed to the final whole-branch review per `superpowers:subagent-driven-development`.
