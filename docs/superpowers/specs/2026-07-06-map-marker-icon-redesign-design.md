# Map Marker Icon Redesign — Design

## Context

RMPG operators want the unit markers on every map surface replaced with a
photographic vehicle icon (a specific RAM 1500 crew-cab reference photo,
rights confirmed for that exact file) instead of the current text-badge/
teardrop markers, while call markers stay a simple recolorable shape.

This spec covers three map surfaces that render unit/call markers:

- `client/src/components/MapboxMiniMap.tsx` — the live Dispatch mini-map
  (confirmed this is the component that actually renders on `/dispatch`
  today; `mapProvider.ts`'s `MapEngine` type only has one value, `'mapbox'`,
  so the sibling `DispatchMiniMap.tsx` never renders in the current build).
- `client/src/components/DispatchMiniMap.tsx` — updated too for consistency
  even though it's currently unreachable, so it doesn't silently regress if
  the map-engine abstraction is ever re-activated.
- `client/src/pages/map/utils/mapMarkers.ts` + the main `/map` page
  (`MapboxMapPage.tsx`) — the full operational map's unit/call markers.

## Goal

Replace unit markers with a fixed-orientation photo icon + status ring +
always-visible call-sign label. Leave call markers as a flat, recolorable
rounded-rectangle badge (unchanged shape convention, still status/priority-
colored).

## Scope

### In scope
- New shared marker-builder helper(s) producing the photo-icon + status-ring
  + label DOM structure, used by all three surfaces above.
- Wiring the new unit-icon builder into `MapboxMiniMap.tsx`'s marker-refresh
  effect (replacing `buildUnitMarkerEl`).
- Wiring the same builder into `DispatchMiniMap.tsx`'s unit-marker code path
  (for consistency; currently dead code per the `MapEngine` finding above).
- Wiring the same builder into `client/src/pages/map/utils/mapMarkers.ts`
  (used by the main `/map` page) so all three surfaces look identical.
- Adding the reference vehicle photo as a static asset in the client build
  (exact path/format TBD at plan time — likely `client/public/icons/` or
  `client/src/assets/`).

### Out of scope (explicitly deferred)
- Call marker shape/behavior — untouched, stays the existing rounded-
  rectangle priority-colored badge.
- Per-unit-type icon variants (e.g. a different photo for motorcycle units,
  K9 units, foot patrol) — the `Unit` type has no `unit_type`/`vehicle_type`
  field today, so every unit gets the same photo icon. Adding per-type icons
  is a separate future spec if/when that data exists.
- GPS-heading-driven rotation — explicitly rejected; the icon has a fixed
  orientation regardless of unit heading (see Rationale).
- Any change to how call-sign labels are computed/formatted — reuses the
  existing `call_sign` value and label-chip styling already used by the
  current teardrop markers.

## Design

### Unit marker structure

Each unit marker becomes a small DOM tree (built once per unit, updated in
place on refresh, matching the existing `buildUnitMarkerEl`/
`buildMapboxUnitMarker`-style helper pattern already used in these files):

1. **Photo container** — a fixed-size (e.g. 40×40px) rounded-square frame
   showing the reference vehicle photo (`object-fit: cover`), so the same
   source image works at a consistent on-map size regardless of its native
   aspect ratio.
2. **Status ring** — a colored border (2–3px) around the photo frame, using
   the existing house status-color tokens (`UNIT_STATUS_HEX` /
   `UNIT_STATUS_COLORS`, already imported in both mini-map components) —
   no new color values, just applied as a `border-color` instead of a fill.
3. **Call-sign label chip** — positioned below the photo frame (same
   relative position as today's teardrop marker's label), always visible,
   text = `call_sign`, background = dark chip matching existing label
   styling, border-color = same status color as the ring (visual tie
   between the two, consistent with today's single-color marker).

The photo itself is NOT recolored, resized per-status, or altered — status
is entirely carried by the ring, exactly as scoped in the brainstorm
discussion (this was the explicit resolution to the
photo-realism-vs-status-color tradeoff).

### Fixed orientation (no rotation)

The marker DOM node has no per-unit rotation transform applied, regardless
of GPS heading/course data. This was an explicit decision: a 3/4-angle
photo rotating in place would look visually broken on a live map, unlike a
top-down icon (which was the earlier design direction before the photo
requirement replaced it). Every occurrence of the photo icon renders
upright, always.

### Asset handling

The reference photo needs to land in the repo as a real static asset before
implementation — it currently only exists as an image pasted into this
conversation, not as a file. The plan will need one of:
- The user supplies the file (e.g. drops it at a path, or it's uploaded
  through some other channel) before implementation starts, or
- The implementer is given an explicit file path to save it to and the user
  confirms the file is in place before the plan's first "wire it up" task
  runs.

Suggested path: `client/public/icons/unit-vehicle.jpg` (or `.png`, matching
whatever format the source file is) — public assets are already the pattern
for static images not needing Vite's asset-hashing pipeline (e.g.
`client/public/rmpg flex.png`, referenced directly in `index.html`).

### Shared builder location

To avoid triplicating the marker-DOM-construction logic across
`MapboxMiniMap.tsx`, `DispatchMiniMap.tsx`, and `mapMarkers.ts`, the photo-
icon + ring + label builder is implemented ONCE as an exported function in
`client/src/pages/map/utils/mapMarkers.ts` (already the shared marker-utils
module per its existing `buildUnitMarker`/`isValidLngLat`/`STATUS_COLORS`
exports used elsewhere), and imported by the two mini-map components rather
than each defining their own copy of `buildUnitMarkerEl`.

## Error handling

- If the photo asset fails to load (404, network issue in a bad-connectivity
  vehicle scenario), the `<img>` element's `onerror` falls back to a plain
  colored square (reusing the status color as a solid fill) so a broken
  image icon never renders — matches the project's existing "never let a
  broken asset blank the map" philosophy seen elsewhere (e.g.
  `safeMapboxColor`'s fallback-hex pattern in `mapboxSafeLayer.ts`).
- No other new error paths — this is a pure marker-rendering change, no new
  network calls or state.

## Testing

- No existing test coverage for `buildUnitMarkerEl`/`buildMapboxUnitMarker`-
  style DOM builders in these files (confirmed via search — no test files
  reference these helpers). Matches this session's already-established
  precedent for `PerformanceTab.tsx`, `AnalyticsTab.tsx`, and other map-
  surface components: no new test files planned for this pass, verified
  manually via the dev-server preview instead.
- Manual verification: load `/dispatch` (with a unit that has a GPS fix) and
  the main `/map` page, confirm the photo icon renders at a consistent size
  with a correctly colored status ring and a readable, always-visible
  call-sign label, for each of the four unit statuses.
