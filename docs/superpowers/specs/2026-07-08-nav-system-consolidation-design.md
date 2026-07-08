# Nav System Consolidation — Design

## Context

The driving-navigation subsystem (`/navigation` in-vehicle HUD, `/nav` trip
history/management, plus supporting hooks/utils under
`client/src/pages/navigation/`, `client/src/hooks/useNav*`,
`client/src/utils/nav*`/`gpxExport.ts`) grew two pages that look similar in
name but serve different purposes:

- **`NavigationPage.tsx`** (`/navigation`) — full-screen in-vehicle drive HUD:
  speedometer, compass, turn-by-turn banner, live route. Routing math lives in
  the app-wide `useNavGuidanceEngine` via `NavTripContext`; this page renders
  engine state onto its own Mapbox map + chase inset.
- **`NavPage.tsx`** (`/nav`) — trip history/management: start/stop trips,
  GPX/CSV export, dropped pins, settings. Uses `NavMapView.tsx`, a lightweight
  breadcrumb mini-map (no routing).

An audit (2026-07-08) of this subsystem found concrete, evidence-based issues
worth fixing before any new nav features are built on top:

1. `client/src/hooks/useNavGuidance.ts` (304 lines) is dead code — zero live
   callers, only referenced in comments — but duplicates concepts
   (hazard-corridor scanning, arrival/reroute logic) that `useNavGuidanceEngine.ts`
   now owns for real. Risk: someone edits the dead file believing it's live,
   or the two silently diverge further.
2. Two independent GPX/CSV serializers exist for the same product feature
   (drive-track export): `utils/gpxExport.ts` + `utils/navCsvExport.ts` (used
   by `NavPage.tsx`) vs. `pages/navigation/hud/trackExport.ts` (used by
   `NavigationPage.tsx`). They have **colliding function names**
   (`gpxExport`, `navCsvExport`) with different signatures and different
   output shapes (different GPX tag layout, different CSV quoting rules).
   The `hud/trackExport.ts` copy is missing proper escaping that the
   canonical `utils/` versions have.
3. `NavigationPage.tsx` and `NavMapView.tsx` each hand-roll ~230 lines of
   near-identical Mapbox bootstrap boilerplate — `initMapbox`, WebGL-context-
   recovery wiring (`installWebglContextRecovery`), and `applyRmpgBasemap`
   re-skin on `style.load` — once for the main+inset map pair in each file.

This spec covers **consolidation and bug fixes only**. New features (offline
tile fallback, multi-stop routing, CarPlay/web guidance-engine unification)
are explicitly out of scope and left as follow-up work — the map-bootstrap
code in particular is safety-critical (rendered in a moving vehicle) and any
feature work there deserves its own design + live device testing.

## Goals

- Remove the dead `useNavGuidance.ts` hook without losing any hazard-corridor
  behavior that might only exist there.
- Collapse GPX/CSV export to one canonical implementation, used by both pages,
  with no name collisions and no divergent output formats.
- Extract the map-bootstrap boilerplate (init + WebGL recovery + basemap
  skinning) shared by `NavigationPage.tsx` and `NavMapView.tsx` into a single
  hook, without changing either page's actual map *behavior* (routing layers,
  chase inset, breadcrumb trail, markers stay where they are — only the
  init/recovery/skin plumbing moves).

## Non-goals

- No new nav features (offline maps, multi-stop routing, CarPlay unification).
- No visual/UX changes to either `/navigation` or `/nav`.
- No changes to the Worker-side trip/routing endpoints.

## Design

### 1. Delete `useNavGuidance.ts`

Before deleting, diff `useNavGuidance.ts`'s hazard-corridor scan
(`HAZARD_CORRIDOR_M`, `HAZARD_LOOKAHEAD_M`, lines ~190-209) against the
equivalent logic in `useNavGuidanceEngine.ts`. If the engine is missing
behavior the dead hook had, port it over first. Then delete
`useNavGuidance.ts` and its test file if one exists. Grep for any remaining
references (comments in `voiceAlerts.ts`, `useMapRouting.ts`) and update or
remove those comments so they don't point at a deleted file.

### 2. Unify GPX/CSV export

`utils/gpxExport.ts` (`trackToGpx`) and `utils/navCsvExport.ts`
(`sessionToCsv`) become the single canonical serializers — they already have
correct XML escaping and are the more complete implementations. Extend them
if needed to cover whatever `pages/navigation/hud/trackExport.ts` currently
does that they don't (check field coverage: speed, heading, timestamp,
elevation).

Delete `pages/navigation/hud/trackExport.ts`. Update `NavigationPage.tsx`'s
two call sites (currently importing `gpxExport`/`navCsvExport` from
`./navigation/hud/trackExport`) to import `trackToGpx`/`sessionToCsv` from
`utils/gpxExport`/`utils/navCsvExport` instead, adapting call sites to the
canonical function signatures.

Result: one GPX shape and one CSV shape for drive-track exports, regardless
of which page triggered the export.

### 3. Extract `useNavMapInstance` shared hook

New file: `client/src/hooks/useNavMapInstance.ts`.

```ts
function useNavMapInstance(opts: {
  containerRef: React.RefObject<HTMLDivElement>;
  styleUrl: string;
  basemapVariant: BasemapVariant;
  initialCenter?: [number, number];
  initialZoom?: number;
}): { map: mapboxgl.Map | null; ready: boolean; error: string | null };
```

Internally owns:
- `initMapbox` token setup
- `new mapboxgl.Map(...)` construction
- `installWebglContextRecovery` wiring
- `applyRmpgBasemap(map, basemapVariant)` re-skin on `style.load`
- Cleanup (`map.remove()`) on unmount

Each caller instantiates this hook once per map instance it needs (e.g.
`NavigationPage.tsx` calls it twice — main drive map + chase inset — and
`NavMapView.tsx` calls it twice — main + inset). Everything downstream of
`ready` (routing layers, congestion gradient, breadcrumb trail, markers, pin
layers) stays exactly where it lives today in each component — only the
init/recovery/skin boilerplate moves into the shared hook.

`error` surfaces the same "non-fatal, map hiccup" cases both files already
tolerate; no behavior change to the existing degrade-gracefully pattern.

## Testing

- Unit tests for the unified `trackToGpx`/`sessionToCsv` covering the field
  set both pages need (extend existing `navCsvExport.test.ts`/add
  `gpxExport.test.ts` coverage if missing).
- Manual verification (per this repo's `verify` skill / preview tooling):
  load `/navigation` and `/nav` in the browser preview, confirm both maps
  still render, confirm GPX/CSV export from each page produces valid output
  with the unified format.
- No live-vehicle testing required for this pass since map *behavior*
  (routing, chase inset, breadcrumb) is unchanged — only the bootstrap
  plumbing is refactored. Live-vehicle testing is recommended before any
  future feature work touches `useNavMapInstance` directly.

## Risks

- `useNavMapInstance` is the highest-risk change (touches map init on two
  safety-relevant screens). Mitigate by keeping the hook's public surface
  minimal (`map`/`ready`/`error` only) and not touching WebGL recovery logic
  itself — just relocating it.
- Deleting `useNavGuidance.ts` is safe only if the hazard-corridor diff in
  step 1 confirms no unique behavior is lost.
