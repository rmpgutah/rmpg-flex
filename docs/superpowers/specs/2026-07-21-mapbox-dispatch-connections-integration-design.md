# Wire Up MapboxDispatchConnections

**Date:** 2026-07-21
**Status:** Approved, pending implementation plan

## Context

`MapboxDispatchConnections.tsx` (`client/src/pages/map/components/`) is a fully-built,
self-contained Mapbox-API diagnostics/action panel — it lists the 5 Mapbox APIs the
app uses for dispatch (Directions, Matrix, Geocoding, Isochrone, Map Matching), shows
a connected/token-required status, and has 6 working action buttons (Best Route,
Validate Address, Reverse Lookup, Response Rings, Static Snapshot, Snap Route) that
each call an existing, real utility function in `client/src/utils/mapboxRouting.ts`.
It has never been mounted anywhere — it was deliberately left orphaned in an earlier
audit ("Map Tab — Real Bugs & Orphaned Feature Cleanup") because it needed a UI
surface, not a slot into an existing dock section at the time.

This spec gives it that surface and — critically — real live data instead of the
placeholder-shaped props it was built against. Its `results: ClosestUnitResult[]`
prop is exactly served by `useMapRouting`'s `findClosestUnit` — a fully-working
real Mapbox Matrix API call (traffic-aware drive-time ranking), already
instantiated as `routing` in `MapboxMapPage.tsx`, but never previously used for
this purpose.

## Design

### Mount point

A new toggle, `{ id: 'mapbox-status', label: 'Mapbox API Status', ... }`, in the
existing right-dock "Diagnostics" section (`mapRightDockSections`), alongside
Feature Inspector, Map Match Trace, GPU Overlay, and Performance HUD — the same
toggle-drives-a-floating-overlay pattern used for every other diagnostics tool
wired onto this tab so far. A new `dispatchConnectionsOpen` boolean state drives
it, following the exact naming/wiring convention of `diagnosticsOpen`/`gpsHudOpen`/
`legendOpen` from the prior plan.

### Data binding

`MapboxDispatchConnections` takes 4 props, all optional:
```ts
interface MapboxDispatchConnectionsProps {
  call?: ActiveCall;
  results?: ClosestUnitResult[];
  matrixActive?: boolean;
  directionsActive?: boolean;
}
interface ClosestUnitResult {
  unit: { id: string; call_sign: string; latitude: number | null; longitude: number | null; status: string };
  distance: number;
  duration: number;
}
```

- **`call`**: the first call in the existing Route Optimizer queue
  (`multiStopQueue[0]`, a `QueuedStop { callNumber, lat, lng, label? }`), looked up
  by `call_number` in the full `calls: ActiveCall[]` state so the panel gets real
  `location_address`/`priority`/etc., not a synthetic object built from the
  queue item's minimal fields. `undefined` when the queue is empty — the
  component already renders every action as disabled in that case (each
  `actionButtons[].enabled` already guards on `Boolean(call?.field)`), so no new
  empty-state code is needed.
- **`results`**: computed by calling `routing.findClosestUnit(unitsForMatrix, dest)`
  where `dest` is the bound call's `{ lat: latitude, lng: longitude }` and
  `unitsForMatrix` is `units` (the existing `MapUnit[]` state) filtered to units
  with a GPS fix, mapped to `{ callSign: call_sign, lat: latitude, lng: longitude }`.
  `findClosestUnit` returns `UnitDriveTime[]`
  (`{ callSign, etaSec, etaText, distanceMeters, distanceText }`), which gets
  adapted to `ClosestUnitResult[]` by looking each `callSign` back up in `units`
  and mapping `etaSec → duration`, `distanceMeters → distance`. This call only
  runs when the panel is open AND there's a bound call (via a `useEffect` keyed on
  `dispatchConnectionsOpen`, the bound call, and `units`) — not continuously — so
  opening the panel with an empty queue costs zero Matrix API calls, and it
  doesn't burn quota while the panel is closed or has nothing to rank.
- **`directionsActive`**: `directionsPanel.result !== null` — the same value
  already used for the existing "Live Directions" dock toggle's `active` field,
  reused verbatim (not a new concept).
- **`matrixActive`**: `true` once the computed `results` array is non-empty.

### No backend changes, no new capability

Every action button already calls a real, working function in
`mapboxRouting.ts` (`fetchMapboxRoute`, `fetchMapboxForwardGeocode`,
`fetchMapboxReverseGeocode`, `fetchMapboxIsochrones`,
`buildMapboxStaticImageUrl`, `fetchMapboxMatchedPath`) — this spec is pure data
wiring: give the already-built component a mount point and real inputs. No new
UI is designed inside `MapboxDispatchConnections.tsx` itself.

## Non-goals

- No changes to `MapboxDispatchConnections.tsx`'s internals (styling, action
  buttons, layout) — it's already fully built and was explicitly left alone in
  the prior audit's Non-goals; this spec only wires it in.
- No new "select a call for diagnostics" UI — deliberately reuses the existing
  Route Optimizer queue as the binding source rather than adding a second,
  parallel call-selection mechanism.
- `useMapRouting`'s `findClosestUnit` itself is not modified — it's already
  correct and complete.

## `_ORPHANS.md` maintenance

Remove the `MapboxDispatchConnections` row from `client/src/pages/map/_ORPHANS.md`'s
"Orphan panels" table (added there by the prior cleanup pass, specifically as a
tracked-but-untouched orphan) — it's no longer orphaned once this spec lands.
