# Map marker/popup CAD-realism redesign

**Date:** 2026-08-09
**Status:** Approved (visual companion), ready for implementation plan

## Context

The map's unit markers, call markers, and popup cards currently use a
stylized, game-like visual language (shield badges, diamond "gem" markers,
loosely-stacked popup fields). This redesign brings them closer to the
conventions of real CAD/AVL software (Spillman, Tyler, Motorola,
ArcGIS/Esri public-safety symbology) while keeping the app's existing
severity/status color palette and `.tactical-dark` fixed-color contract
(see [`CLAUDE.md`](../../../CLAUDE.md) Design tokens section).

All decisions below were validated with the user via the brainstorming
visual companion (4 rounds of mockups/iteration) before this spec was
written. Nothing here is speculative.

Implementation surface is entirely
[`client/src/pages/map/utils/mapMarkers.ts`](../../../client/src/pages/map/utils/mapMarkers.ts)
— confirmed as the module `MapboxMapPage.tsx` actually imports
(`buildUnitMarkerEl`, `applyUnitMarkerState`, `buildUnitPopupHtml`,
`buildCallMarkerEl`, `buildCallPopupHtml`). The sibling
`client/src/utils/mapMarkers.ts` is a **different, unrelated** module (used
by `DashboardMiniMap.tsx`, `ForensicTrackMap.tsx`, etc.) and is explicitly
**out of scope** — do not touch it.

## 1. Unit marker (`buildUnitMarkerEl` / `applyUnitMarkerState`)

**Current:** a 30×30px filled circle badge (status color background) with a
vehicle-silhouette glyph, rotated to `gps_heading`, plus a bordered
call-sign label below.

**New:**
- Replace the filled circular badge with a **plain colored triangular
  arrow** (no ring, no filled disc, no vehicle glyph) — an SVG path
  (e.g. `M12 2 20 21 12 16 4 21Z`), `fill` = status color, rotated to
  `gps_heading` (falls back to pointing north / `rotate(0)` when heading is
  null, same as today's "no rotation applied" fallback).
- Keep the existing flat black (`#000` or the existing
  `TACTICAL_BADGE_SURFACE`) bordered label beside/below the arrow, border +
  text colored by status — this part of the current implementation is
  already correct and should be reused, not rebuilt.
- Preserve all existing staleness behavior (opacity dimming, dashed gray
  ring substitute becomes a dashed/gray arrow outline for `stale`/`lost`),
  the accuracy ring, and the no-transform-on-root contract documented in
  the current file's comments — none of that changes, only the glyph shape.
- Status color mapping is unchanged (`UNIT_STATUS_COLORS`); no new statuses
  introduced.

## 2. Call marker (`buildCallMarkerEl`)

**Current:** a 22×22px diamond (rotated square) filled with the priority
color, with the priority label (`P1`..`P4`) inside, rotated back to
horizontal.

**New:**
- Change the shape from a **rotated diamond** to a **plain rounded square**
  (`border-radius: 2px`, matching the app's global "radius-2 everywhere"
  rule — no `transform: rotate()` at all, which also removes the jsdom
  cssText/border-radius interaction bug comment currently guarding the
  diamond's inline styles).
- Keep priority-color fill and the priority code text inside
  (`priorityLabel(call.priority)`), same ink color (`CALL_MARKER_INK`).
- **Add a label below the square**, in the same visual style as the unit
  marker's label (flat black background, border + text colored by
  priority), showing the call number (e.g. `CFS26-00153`) — this is new;
  today the call number only appears in the popup/title attribute, not on
  the map itself.
- Priority color scale is unchanged (`priorityHex`); no new priorities
  introduced.

## 3. Call popup card (`buildCallPopupHtml`)

**Current:** loosely stacked plain-text fields (call number, type,
priority, status, address, cross street, beat, hazard flag chips, add-to-
route button) with generous vertical spacing.

**New layout, top to bottom:**
1. **Header bar**, background = priority color (`priorityHex`), containing:
   - Call number (e.g. `CFS26-00153`), left-aligned, bold monospace, ink
     color per priority (`CALL_MARKER_INK`)
   - **Call-age timer** directly under the call number, small text,
     format `⏱ HH:MM:SS open` — see Timers section below for the
     compute/refresh contract
   - Priority code badge (`P1`..`P4`), right-aligned, small pill
2. Incident type / description, bold, below the header bar
3. **Labeled field table** (label left column muted, value right column
   primary text): `STATUS`, `BEAT`, `ADDRESS` (+ `CROSS` when
   `cross_street` is present), `UNIT` (shows the assigned unit's call sign,
   or an em-dash placeholder like `— unassigned —` when none)
   - When a unit is assigned and its status is `en_route`, two more rows
     appear: `ETA` and `DISTANCE` (see Timers section)
4. Hazard flag chips (unchanged from current, same `HAZARD_FLAGS` styling)
5. `+ ADD TO ROUTE` button (unchanged behavior/data attributes, restyled to
   sit as a full-width footer row with a top border rather than a standalone
   bordered button)

The existing `queued` / disabled "✓ ON ROUTE" state is preserved as-is,
just restyled to match the new footer row treatment.

## 4. En-route map indicator (new — no current equivalent)

Shown **only** while a unit's `current_call_id` is set and that unit's
status is the "en route" status (per `UnitStatus`/`UNIT_STATUS_COLORS`
enum — confirm exact enum value during implementation, e.g. `en_route`).
Disappears the moment the unit's status changes to on-scene or the call
is cleared.

**Placement:** a small tag rendered beside the unit's arrow marker (same
marker element, appended as a sibling of the existing label — do not
create a second `mapboxgl.Marker`, which would double the position-sync
and animation logic already carried by `buildUnitMarkerEl`/
`applyUnitMarkerState`).

**Content, compact 2-column grid** (confirmed final layout after
comparing a 4-line stacked variant):

```
D190      ENROUTE
ETA 03:12 DIS 1.4mi
```

- Unit call sign (top-left)
- Literal text `ENROUTE` (top-right)
- `ETA mm:ss` (bottom-left) — mm:ss countdown, not HH:MM:SS (en-route legs
  are commonly short; hours are not the common case, and mm:ss matches the
  mockup exactly)
- `DIS ##.# mi` (bottom-right) — one decimal place

**Data source for ETA/DISTANCE:** use
[`fetchMapboxRoute`](../../../client/src/utils/mapboxRouting.ts) (already
used elsewhere for Live Directions/Route Optimizer) with the unit's current
`(latitude, longitude)` as origin and the call's `(latitude, longitude)` as
destination — real routed duration/distance, not a straight-line haversine
estimate. This is a deliberate choice: `haversineDistance` is already
imported in this file and would be trivial to reuse, but it materially
understates real drive time/distance in a street grid, which is
misleading for a live dispatch operator. Poll/refresh cadence and
caching strategy (avoid calling Directions on every GPS tick) is an
implementation-plan decision, not a design one — flag it there.

Matching `ETA`/`DISTANCE` rows are added to the popup card (§3 above)
using the same computed values, so the map tag and the popup never show
different numbers for the same unit/call pair.

## Explicitly out of scope

- The sibling `client/src/utils/mapMarkers.ts` module and every component
  that imports it (mini-maps, forensic track map, connections panel, etc.)
- Any other overlay's visual style (heatmaps, traffic, boundaries, weather
  radar) — those were audited separately and are functioning correctly
  (see prior session work fixing the weather-radar CSP bug)
- New call-priority levels, new unit statuses, or changes to the underlying
  color palettes (`UNIT_STATUS_COLORS`, `priorityHex`) — this is a shape/
  layout redesign only, not a palette change
- Turn-by-turn navigation UI, the Route Optimizer panel, or GPS HUD — the
  en-route tag is a passive map indicator, not an interactive routing tool

## Testing expectations

`client/src/pages/map/utils/__tests__/mapMarkers.test.ts` already covers
this module (unit marker staleness, call marker priority rendering, popup
HTML). The implementation plan must update/extend these tests for the new
shapes, the added call-number label, the popup's new header/timer/ETA rows,
and the new en-route tag — not replace the file's existing coverage of
staleness dimming, accuracy rings, or the animate-vs-snap jump threshold,
all of which are unaffected by this redesign.
