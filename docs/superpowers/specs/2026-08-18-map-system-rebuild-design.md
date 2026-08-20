# Map System Rebuild Design

**Date:** 2026-08-18  
**Scope:** Two-PR rebuild of the RMPG Flex map subsystem — structural refactor + role-adaptive UI (PR A), then feature expansion (PR B).

---

## Problem Statement

`MapboxMapPage.tsx` is 2,331 lines and hosts ~45 hook imports. All subsystem logic (GPS tracking, isochrone, welfare timer, beat overlay), all UI panels, and the Mapbox GL canvas orchestration live in a single file. Changing anything requires understanding the entire file. Two duplicate files exist (`mapMarkers.ts`, `useMapBreadcrumbs.ts`). The layout is not role-sensitive — dispatchers and field officers see the same chrome.

Pain points confirmed by user: layout/UX (B), missing features (C), codebase hard to change (D), occasionally performance (A). Feature priority: assignment arcs → beat management UI → Search Box v6.

---

## Approach

**Approach B — Refactor + UI redesign together, features separate.**

Structural cleanup and role-adaptive layout are deeply coupled: you cannot reorganize the panel layout without first extracting the subsystems the panels depend on. Doing them in one PR avoids editing the same megafile twice. Feature expansion (PR B) lands cleanly on top of the new architecture.

---

## PR A — Structural Refactor + Role-Adaptive UI

### Architecture

`MapboxMapPage.tsx` becomes a pure canvas orchestrator (~400 lines). It:
- Initializes the Mapbox GL instance and token
- Establishes `MapContext` (map ref + live-sync state)
- Renders `MapLayout`

All subsystem logic moves to focused extracted hooks. All UI panel layout moves to role-specific layout components.

### MapContext

New React context at `client/src/pages/map/MapContext.ts`:

```ts
interface MapContextValue {
  map: mapboxgl.Map | null;
  units: Unit[];
  calls: Call[];
  beats: Beat[];
}
```

Provided by `MapboxMapPage`, consumed by extracted hooks and layout components. Replaces current prop-drilling through ~45 hooks.

### Extracted Hooks

Each hook reads `map` from `MapContext` via `useContext(MapContext)`. Each returns a stable interface and degrades silently when `map` is null (common during mount).

| Hook | Extracted from | Responsibility |
|------|---------------|----------------|
| `useMapGps.ts` | MapboxMapPage | GPS trail rendering, breadcrumb logic |
| `useMapIsochrone.ts` | MapboxMapPage | Isochrone polygon + nearest-unit calculation |
| `useMapWelfare.ts` | MapboxMapPage | Welfare timer overlay markers |
| `useMapBeatOverlay.ts` | MapboxMapPage | Beat boundary GeoJSON layer rendering |

**Error handling:** each hook uses `log.error` from `src/utils/logger` and returns empty/null state on failure. No hook throws to the render tree.

### Duplicate Resolution

Before extracting, resolve duplicates:
- `mapMarkers.ts` — check import count (`grep -r "mapMarkers" client/src --include="*.ts" --include="*.tsx" -l`). Keep the more-referenced file, delete the other, update all imports.
- `useMapBreadcrumbs.ts` — same process.

### Role-Adaptive Layout

`client/src/pages/map/MapLayout.tsx` reads `user.role` from `useAuth()` and renders:

```
admin | manager | supervisor | dispatcher  →  DispatcherMapLayout
officer                                    →  FieldMapLayout
client_viewer                              →  FieldMapLayout (read-only: no controls)
```

**`DispatcherMapLayout.tsx`**
- Left dock: Unit Status Board (existing component, lifted from current inline render)
- Right dock: Active Calls Board (existing component, lifted)
- Bottom-right controls: Optimize Assignments button (supervisor+ role guard: `admin|manager|supervisor`)
- Beat Planner button (supervisor+)

**`FieldMapLayout.tsx`**
- Minimal chrome: personal GPS trail, own unit status
- Beat panel: current beat boundaries + assignment
- Navigation controls
- No visibility into other units except welfare-flagged ones

Neither layout component touches the `map` ref directly — they orchestrate panels and their own data hooks. The map canvas is owned by `MapboxMapPage`.

### File Structure

```
client/src/pages/map/
  MapboxMapPage.tsx            SHRINK  (canvas orchestrator, ~400 lines)
  MapContext.ts                NEW     (MapContextValue + MapContext + useMapContext)
  MapLayout.tsx                NEW     (role router)
  layouts/
    DispatcherMapLayout.tsx    NEW     (left/right docks + supervisor controls)
    FieldMapLayout.tsx         NEW     (minimal field chrome)
  hooks/
    useMapGps.ts               NEW EXTRACT
    useMapIsochrone.ts         NEW EXTRACT
    useMapWelfare.ts           NEW EXTRACT
    useMapBeatOverlay.ts       NEW EXTRACT
```

Existing hooks (`useMapBreadcrumbs`, `useDistrictLookup`, etc.) are unchanged — they already have clean interfaces.

### Design Constraints (from CLAUDE.md)

- **Do not move the Mapbox GL container element** — `absolute inset-0` on a Mapbox container collapses to ~12px when position is not correct; mapbox-gl.css wins on source order. Keep the canvas div exactly where it is.
- **No hardcoded hex** — all colors via CSS variables / Tailwind tokens from `theme-palettes.css`.
- **Radius 2px everywhere** — never `rounded-lg`.
- **`useLiveSync` stays in `MapboxMapPage`** — WebSocket auth dance is at upgrade time; keep it at the top level.

### Testing

- Each extracted hook: vitest unit test asserting return shape and no-throw when `map` is `null`.
- `MapLayout`: snapshot test for each role string verifying which layout component renders.
- Full client vitest suite must pass (`cd client && npx vitest run`).
- Browser preview verification after implementation (per CLAUDE.md UI workflow).

---

## PR B — Feature Expansion

Lands on the PR A architecture. Three features in priority order.

### Feature 1: Unit-to-Call Assignment Arc Layer

**File:** `client/src/pages/map/layers/AssignmentArcLayer.tsx`

Uses `@deck.gl/mapbox`'s `MapboxOverlay` (already in the project) with a Deck.gl `LineLayer`. No new API call — unit assignment state is already in `MapContext` (units carry `assigned_call_id`; calls carry their GPS coordinate).

Data shape fed to `LineLayer`:
```ts
interface ArcDatum {
  sourcePosition: [lng: number, lat: number]; // unit current GPS
  targetPosition: [lng: number, lat: number]; // assigned call location
  unitId: number;
  callId: string;
  priority: number; // maps to arc color via severity palette
}
```

Arc color follows CAD severity palette (`--sev-critical`, `--sev-high`, etc.) — not brand chrome. Arcs only render for units in `assigned` or `onscene` status with a non-null `assigned_call_id`.

`AssignmentArcLayer` is mounted inside `DispatcherMapLayout` (dispatchers need to see assignments; field officers do not).

### Feature 2: Beat Management Panel

**File:** `client/src/pages/map/panels/BeatManagementPanel.tsx`

Replaces `PatrolBeatPlannerModal.tsx` (the modal added in the Mapbox V2 PR) with a proper side panel. The modal was a quick solution; a panel fits the layout system better and avoids z-index fighting with map popups.

Panel sections:
1. **Beat list** — fetches `/dispatch/beats`; shows name, current assigned unit(s), shift window.
2. **Assignment controls** — drag unit onto beat or use dropdown. Posts to `/dispatch/beat-assignments` (existing endpoint or new, TBD during implementation).
3. **Patrol planning** — the existing V2 optimization flow (beat selection + unit selection + datetime inputs + submit). Lifted from `PatrolBeatPlannerModal`.

The panel slides in from the right when opened via the Beat Planner button in `DispatcherMapLayout`. Uses the existing panel slide-in pattern (same as the call detail panel).

`PatrolBeatPlannerModal.tsx` is deleted once `BeatManagementPanel` covers its functionality.

### Feature 3: Search Box v6 Upgrade

Upgrade Mapbox Search Box from v5 to v6 in the map toolbar. v6 brings the `SearchBoxCore` / `SearchBoxSuggestion` API, typed responses, and category search.

**File:** `client/src/pages/map/MapSearchBox.tsx` (extract from current inline toolbar)

Changes:
- Replace `mapbox-search-js-react` v5 import with v6 (check `client/package.json` for current pin before upgrading).
- Use `SearchBoxCore` for programmatic suggestion fetching.
- On selection, pan + zoom to result bbox (existing behavior preserved).
- Proximity bias from current map center (existing behavior preserved).

---

## Out of Scope

- Migrating Google Maps / MapLibre references — only a stale type reference exists in `mapboxRouting.ts`; leave it.
- Deck.gl version upgrade — use current installed version.
- `MapPage.tsx` (~6k lines) and `DispatchPage.tsx` (~6k lines) megafile splits — out of scope for this rebuild; opportunistic only if already in those files.

---

## Success Criteria

**PR A:**
- `MapboxMapPage.tsx` ≤ 500 lines
- All duplicate files resolved
- Role-based layout renders correctly for all 8 roles (verified in browser)
- Full client vitest suite passes
- Worker typecheck passes

**PR B:**
- Assignment arcs visible for units with active call assignments
- Beat Management Panel opens/closes from toolbar, covers full patrol planning flow
- Search Box v6 functional with proximity bias
- Full client vitest suite passes
- `PatrolBeatPlannerModal.tsx` deleted
