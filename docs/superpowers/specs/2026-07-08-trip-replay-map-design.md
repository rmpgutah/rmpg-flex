# Trip Replay Map

**Date**: 2026-07-08
**Status**: Approved, ready for implementation plan

## Context

`MovementReportDrawer.tsx`'s `TripReplay` sub-component (added in commits
`e850f76ca5` / `acfb389f5d` / `dfed6a6ebf` on branch
`claude/nav-system-build-d9fcf5`) drives playback of a trip's breadcrumb
track via `tripReplay.ts`'s pure `replayIndexAt`/`replayDurationMs` helpers,
but only renders a numeric lat/lng/speed/heading readout — no map, no moving
marker. This was a deliberate scope decision at the time: the drawer has no
Mapbox instance, and there was no small/scoped map-init pattern to reuse.

`points: ReplayPoint[]` is already wired into the drawer from both
`NavigationPage.tsx` (live session) and `TripsDrawer.tsx` (historical trip),
so no new data plumbing is needed — only a rendering component.

`NavMapView.tsx` (the existing Mapbox mini-map, `client/src/components/`) is
too heavy to reuse directly: it's built for live GPS following (breadcrumb
trail aging/decimation, inset 3D chase cam, style switcher, drop-pins,
day/night theme). This design introduces its own small, purpose-built map
component instead, borrowing only the low-level Mapbox init pattern
(`initMapbox`/`mapboxgl` from `mapboxLoader.ts`, `applyRmpgBasemap` for the
dark re-skin).

## Goal

Add a small map to the Trip Replay section of `MovementReportDrawer.tsx`
that draws the full breadcrumb polyline and animates a marker along it as
`elapsedMs`/`replayIndexAt` advances, without disrupting the existing
play/pause/scrubber/speed-multiplier controls or the numeric readout below
them.

## Design

### New file: `client/src/pages/navigation/TripReplayMap.tsx`

```ts
interface TripReplayMapProps {
  points: ReplayPoint[];
  replayIdx: number;
}
export default function TripReplayMap({ points, replayIdx }: TripReplayMapProps)
```

**Sizing**: fixed 140px-tall container, full width of the drawer's content
column (matches the scale of the existing Speed Profile chart / friction
circle — a supporting visual, not the focus).

**Init** (mirrors `NavMapView`'s pattern, stripped to what this needs):
- `getMapboxAccessToken()` → `initMapbox(token)` → construct `mapboxgl.Map`
  in the container ref.
- `attributionControl: false`, `interactive: false` (no pan/zoom/drag — this
  is a passive visual; all scrubbing stays on the existing range slider),
  `pitch: 0`, `bearing: 0`, no rotate — 2D only, same constraint as
  `NavMapView`'s main map.
- Style: reuse `MAPBOX_STYLE_DARK` (no day/night/theme switching needed —
  this is a small embedded visual, not a primary map surface).
- On `style.load`: `applyRmpgBasemap(map, { variant: 'dark' })` for the same
  re-skin `NavMapView` applies.
- On `load`: add three sources/layers —
  - `traveled` (line, gold `#d4a017`, width 3, matches `NavMapView`'s trail
    color) — the portion of the trip from index 0 to `replayIdx`.
  - `remaining` (line, dim gray `#4b5563`, width 2) — from `replayIdx` to
    the end. The two segments share their boundary vertex (`points[replayIdx]`)
    so they join without a visible gap.
  - `marker` (circle, same gold-dot-with-halo styling as `NavMapView`'s
    position dot) — a single point at `points[replayIdx]`.
- `map.fitBounds(...)` to the full track's bounding box once, on `load`,
  with padding (~16px) and `duration: 0`. **The camera never moves again**
  after this — no follow-camera, no re-fit on `replayIdx` changes. This
  keeps the whole trip visible at a glance and avoids animation jitter in a
  140px map.

**Per-`replayIdx` update** (a single `useEffect` keyed on `[replayIdx, points]`,
no map re-init):
- Slice `traveled = points.slice(0, replayIdx + 1)`,
  `remaining = points.slice(replayIdx)`.
- `setData(...)` on the `traveled` and `remaining` GeoJSON sources, and
  `setData(...)` (or `setLngLat` if using a `Marker` instead of a circle
  layer — circle layer preferred for consistency with `NavMapView`) on the
  `marker` source.
- No camera changes on this path — cheap coordinate-array updates only.

**Error handling**: same tolerant pattern as `NavMapView` — if
`getMapboxAccessToken()` returns falsy, or the map fires an auth `error`
event, the component renders `null` (no error box). This is a supporting
visual inside an already-optional drawer section (`TripReplay` itself only
renders when `points.length >= 2`); a missing/misconfigured token should
silently fall back to the numeric readout, not show a broken/error state
inside a drawer.

**Cleanup**: standard `mapRef.current?.remove()` on unmount, matching every
other Mapbox component in the codebase.

### Wiring into `TripReplay` (`MovementReportDrawer.tsx`)

- Render `<TripReplayMap points={points} replayIdx={replayIdx} />` between
  the "Trip replay" section header and the existing play/pause/scrubber row.
- The numeric lat/lng/speed/heading readout stays exactly as-is, unchanged,
  below the scrubber row.
- No new props on `MovementReportDrawer` itself — `points` and `replayIdx`
  are already computed/in-scope inside `TripReplay`.
- Update the component's existing comment (currently: *"No map here (this
  drawer is purely tabular/chart), so playback drives a numeric readout...
  rather than a moving marker"*) to reflect the new behavior.

## Out of scope

- Click-to-scrub on the polyline (map stays passive; explicitly deferred).
- Camera follow / chase-cam behavior (fixed bounds-fit only).
- Day/night theme switching for this specific map (always dark, matches the
  drawer's own dark chrome).
- Any change to `tripReplay.ts`'s pure helpers — `replayIndexAt`/
  `replayDurationMs` are unchanged and already correct for this use.

## Testing

No new pure logic warrants a unit test (bounds-fit and array slicing are
trivial and exercised implicitly by rendering). Verify visually via the dev
server: load a historical trip in `TripsDrawer` and a live session in
`NavigationPage`, confirm the map renders, the traveled/remaining trail
splits correctly as playback advances, and the marker tracks `replayIdx`
through play, pause, scrub, and speed-multiplier changes.
